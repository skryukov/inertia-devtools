import type { InertiaPage } from './protocol'
import type {
  CapturedEvent,
  RequestRecord,
  ActiveFeature,
  VisitType,
  InertiaVisitDetail,
  WireRequestData,
  WireResponseData,
} from './types'
import type { NetworkTiming } from './network'
import { visitUuid, wireBodySize } from './wire'
import { redactDeep, redactHeaders } from './redact'
import { extractFeatures, extractPageFeatures } from './features'
import { computeDiagnostics } from './diagnostics'
import { normalizeUrl } from './url'

const MAX_PENDING_NETWORK = 10
const MAX_PENDING_PREFETCH = 20
const NETWORK_TIMING_TOLERANCE_MS = 2000

/**
 * Correlates individual Inertia events into logical RequestRecords.
 *
 * Correlation strategy (requires Inertia >= 3.4):
 * - Every visit carries a UUID (`visit.id`). Events carrying the visit object
 *   (`before`/`start`/`finish`/`prefetching`/`prefetched`) and events carrying a
 *   top-level `visitId` (`navigate`/`success`/`error`/`clientVisit`) resolve to
 *   records by exact id match.
 * - Events with no id at all (`progress`, `beforeUpdate`, `flash`,
 *   `httpException`, `networkError`) fall back to the most recently started
 *   in-flight record. `flash` additionally falls back to the most recent record
 *   overall, because `router.flash()` fires with no visit in flight.
 *   Fallback-attributed events are flagged `heuristic` so the UI can mark them.
 * - Prefetch visits: `inertia:before` fires even when the prefetch cache is
 *   still fresh (no request follows). Record creation is deferred until
 *   `inertia:start` confirms a real request went out.
 * - Cache-served clicks (`navigate` with `cached: true`) never receive
 *   `start`/`finish` — they are finalized when `navigate` arrives.
 */
export class Correlator {
  private nextVisitId = 1
  private records: Map<number, RequestRecord> = new Map()
  private sortedRecords: RequestRecord[] = []
  private maxRecords: number
  /** Inertia visit UUID → devtools record id. */
  private uuidMap: Map<string, number> = new Map()
  /** Prefetch before-events awaiting confirmation (inertia:start), keyed by visit UUID. */
  private pendingPrefetch: Map<string, { event: CapturedEvent; timestamp: number }> = new Map()
  private lastPage: InertiaPage | null = null
  /** Buffer of unmatched network timing entries for late correlation. */
  private pendingNetwork: NetworkTiming[] = []
  private _evictedCount = 0

  constructor(maxRecords = 200) {
    this.maxRecords = maxRecords
  }

  /**
   * Process a captured event and correlate it to a RequestRecord.
   * Returns the affected RequestRecord, or null if correlation failed.
   */
  processEvent(event: CapturedEvent): RequestRecord | null {
    const { name, detail, timestamp } = event

    switch (name) {
      case 'inertia:before':
        return this.handleBefore(event, detail, timestamp)

      case 'inertia:start':
        return this.handleStart(event, detail)

      case 'inertia:finish':
        return this.handleFinish(event, detail, timestamp)

      case 'inertia:navigate':
        return this.handleNavigate(event, detail)

      case 'inertia:beforeUpdate':
        return this.handleBeforeUpdate(event, detail)

      case 'inertia:clientVisit':
        return this.handleClientVisit(event, detail)

      default:
        return this.handleGenericEvent(event, detail)
    }
  }

  getRequests(): RequestRecord[] {
    return this.sortedRecords
  }

  getRequest(visitId: number): RequestRecord | undefined {
    return this.records.get(visitId)
  }

  getCurrentPage(): InertiaPage | null {
    return this.lastPage
  }

  get evictedCount(): number {
    return this._evictedCount
  }

  hasRequestWithUrl(url: string): boolean {
    const path = normalizeUrl(url)
    for (let i = this.sortedRecords.length - 1; i >= 0; i--) {
      if (normalizeUrl(this.sortedRecords[i].url) === path) return true
    }
    return false
  }

  clear(): void {
    this.records.clear()
    this.sortedRecords = []
    this.uuidMap.clear()
    this.pendingPrefetch.clear()
    this.pendingNetwork = []
    this._evictedCount = 0
    this.nextVisitId = 1
    // Note: lastPage is NOT cleared -- it represents the current app state
  }

  /**
   * Attach request wire data (from the request interceptor) by Inertia visit UUID.
   * The interceptor fires inside Request.send(), after the before/start events
   * created the record — a miss means the record was evicted; drop silently.
   */
  attachWireRequest(uuid: string, request: WireRequestData): RequestRecord | null {
    const record = this.resolveByUuid(uuid)
    if (!record) return null
    record.wire = { ...record.wire, request: { ...request, headers: redactHeaders(request.headers) } }
    return record
  }

  /** Attach response wire data (from the response interceptor) by Inertia visit UUID. */
  attachWireResponse(uuid: string, response: WireResponseData): RequestRecord | null {
    const record = this.resolveByUuid(uuid)
    if (!record) return null
    record.wire = { ...record.wire, response: { ...response, headers: redactHeaders(response.headers) } }
    if (record.status === undefined && response.status !== undefined) {
      record.status = response.status
    }
    return record
  }

  /**
   * Link a network timing entry (from PerformanceObserver) to a visit.
   * Returns the matched RequestRecord, or null if no match found.
   */
  linkNetworkTiming(timing: NetworkTiming): RequestRecord | null {
    const match = this.findNetworkMatch(timing)
    if (match) {
      this.attachNetworkTiming(match, timing)
      return match
    }

    // Buffer unmatched entries for late correlation (visit may not have finished yet)
    this.pendingNetwork.push(timing)
    if (this.pendingNetwork.length > MAX_PENDING_NETWORK) {
      this.pendingNetwork.shift()
    }
    return null
  }

  /**
   * Try to match pending network timing entries to a visit that just finished.
   * Called internally after handleFinish to pick up late arrivals.
   */
  private drainPendingNetwork(record: RequestRecord): void {
    for (let i = this.pendingNetwork.length - 1; i >= 0; i--) {
      const net = this.pendingNetwork[i]
      if (this.networkMatchesVisit(net, record)) {
        this.attachNetworkTiming(record, net)
        this.pendingNetwork.splice(i, 1)
        return
      }
    }
  }

  /**
   * Attach a Resource Timing entry, using its status as a fallback for
   * responses no interceptor reports (non-Inertia errors, dev: false apps). On Inertia
   * 3.4/3.5 a 409 hard reload fires no event at all — this is its only trace.
   */
  private attachNetworkTiming(record: RequestRecord, timing: NetworkTiming): void {
    record.network = timing
    if (record.status === undefined && timing.responseStatus !== undefined) {
      record.status = timing.responseStatus
      record.diagnostics = computeDiagnostics(record)
    }
  }

  private findNetworkMatch(timing: NetworkTiming): RequestRecord | null {
    for (let i = this.sortedRecords.length - 1; i >= 0; i--) {
      const req = this.sortedRecords[i]
      if (req.network) continue
      if (this.networkMatchesVisit(timing, req)) {
        return req
      }
    }
    return null
  }

  private networkMatchesVisit(timing: NetworkTiming, req: RequestRecord): boolean {
    const netPath = normalizeUrl(timing.url)
    const reqPath = normalizeUrl(req.url)
    if (netPath !== reqPath) return false

    // Timing: network started after or around visit start, with tolerance
    if (timing.startedAt < req.startedAt - NETWORK_TIMING_TOLERANCE_MS) return false

    // If visit has finished, network should have started before visit finish + tolerance
    if (req.finishedAt && timing.startedAt > req.finishedAt + NETWORK_TIMING_TOLERANCE_MS) return false

    return true
  }

  private handleBefore(event: CapturedEvent, detail: Record<string, unknown>, timestamp: number): RequestRecord | null {
    const visit = this.extractVisit(detail)
    const uuid = visitUuid(visit)

    // Prefetch visits: inertia:before fires even when the cache is still fresh
    // (no request follows). Defer record creation until inertia:start confirms
    // a real request. Keyed by UUID so concurrent prefetches don't clobber each
    // other. Prevented prefetches never get a start — record them right away.
    if (!event.prevented && visit?.prefetch && uuid) {
      this.pendingPrefetch.set(uuid, { event, timestamp })
      if (this.pendingPrefetch.size > MAX_PENDING_PREFETCH) {
        const oldest = this.pendingPrefetch.keys().next().value
        if (oldest !== undefined) this.pendingPrefetch.delete(oldest)
      }
      return null
    }

    const visitId = this.nextVisitId++

    const method = (visit?.method ?? 'GET').toUpperCase()
    const url = this.extractUrl(visit)
    const isDeferred = visit != null && this.isDeferredReload(visit)

    // Detect deferred prop reload: find parent visit for linking
    let parentVisitId: number | undefined
    if (isDeferred) {
      parentVisitId = this.findParentVisitId(url)
    }

    const only = visit?.only?.length ? visit.only : undefined
    const except = visit?.except?.length ? visit.except : undefined

    const visitOptions = visit ? this.extractVisitOptions(visit) : undefined

    const record: RequestRecord = {
      visitId,
      inertiaVisitId: uuid,
      parentVisitId,
      type: isDeferred ? 'deferred' : this.classifyVisitType(visit),
      method,
      url,
      only,
      except,
      startedAt: timestamp,
      events: [event],
      features: [],
      diagnostics: [],
      cancelled: false,
      interrupted: false,
      completed: false,
      previousPage: this.lastPage ?? undefined,
      visitOptions,
    }

    // A listener called preventDefault(): the router bails out before start,
    // so nothing would ever finalize this record. Finalize it here — a visit
    // the app blocked is signal, not an in-flight phantom. (Visits rejected by
    // an onBefore() callback returning false never fire the DOM event at all
    // and are invisible to devtools by design.)
    if (event.prevented) {
      record.prevented = true
      record.finishedAt = timestamp
      record.duration = 0
      record.diagnostics = computeDiagnostics(record)
    }

    this.insertRecord(record)
    if (uuid) {
      this.finalizeSupersededVisit(uuid, url, timestamp)
      this.uuidMap.set(uuid, visitId)
    }

    return record
  }

  /**
   * Inertia reuses a visit id when it follows an `x-inertia-redirect`:
   * `handleNonInertiaResponse` calls `router.visit(target, {...requestParams.all()})`,
   * and `getPendingVisit` spreads those options AFTER `id: createVisitId()`, so
   * the original id wins (3.4.0 dist:3452-3459). Two records then claim one uuid.
   *
   * Left alone the first record never finishes: its `finish` is routed to the
   * second, `resolveInFlight` keeps handing it every id-less event (progress,
   * httpException, networkError, flash), and `evictOldest` *prefers* finished
   * records, so the zombie outlives everything while its `events` array grows.
   *
   * Finalizing it here is also the truthful reading — the server did redirect
   * that request — so the row reads as a redirect instead of hanging in flight.
   */
  private finalizeSupersededVisit(uuid: string, nextUrl: string, timestamp: number): void {
    const previousId = this.uuidMap.get(uuid)
    if (previousId === undefined) return
    const previous = this.records.get(previousId)
    if (!previous || previous.finishedAt != null) return

    previous.finishedAt = timestamp
    previous.duration = timestamp - previous.startedAt
    previous.completed = true
    if (!previous.page) {
      previous.type = 'redirect'
      previous.redirectUrl ??= nextUrl
    }
    previous.diagnostics = computeDiagnostics(previous)
  }

  private handleStart(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    const visit = this.extractVisit(detail)
    const uuid = visitUuid(visit)

    // Pending prefetch confirmed: a real request went out (cache hits never get start).
    if (uuid && visit) {
      const pending = this.pendingPrefetch.get(uuid)
      if (pending) {
        this.pendingPrefetch.delete(uuid)
        return this.createPrefetchRecord(visit, uuid, pending.event, event, pending.timestamp)
      }
    }

    // Explicit ids resolve exactly or not at all; the in-flight fallback only
    // serves genuinely id-less (pre-3.4) payloads.
    const record = uuid ? this.resolveByUuid(uuid) : this.resolveInFlight()
    if (record) {
      if (!uuid) event.heuristic = true
      record.events.push(event)
    }
    return record
  }

  private handleFinish(event: CapturedEvent, detail: Record<string, unknown>, timestamp: number): RequestRecord | null {
    const visit = this.extractVisit(detail)
    const uuid = visitUuid(visit)
    const record = uuid ? this.resolveByUuid(uuid) : this.resolveInFlight()
    if (!record) return null

    if (!uuid) event.heuristic = true
    record.events.push(event)
    record.finishedAt = timestamp
    record.duration = timestamp - record.startedAt

    if (visit) {
      record.completed = !!visit.completed
      record.cancelled = !!visit.cancelled
      record.interrupted = !!visit.interrupted
    }

    // Try to match any pending network records to this visit
    if (!record.network) {
      this.drainPendingNetwork(record)
    }

    // Deferred requests may not have page data yet (navigate carries the merged
    // page, but by finish time lastPage holds the merged props either way).
    if (record.type === 'deferred') {
      if (!record.page && this.lastPage) {
        record.page = this.lastPage
        record.features = extractFeatures(record, this.lastPage)
      }
      // If previousPage wasn't set (initial page load race), get it from the parent
      if (!record.previousPage && record.parentVisitId) {
        const parent = this.records.get(record.parentVisitId)
        if (parent?.page) {
          record.previousPage = parent.page
        }
      }
    }

    record.diagnostics = computeDiagnostics(record)

    return record
  }

  private handleNavigate(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    const page = detail.page as InertiaPage | undefined
    const visitId = typeof detail.visitId === 'string' ? detail.visitId : undefined

    // Snapshot the pre-navigate page state before updating it — synthetic
    // records created below need it as their diff baseline.
    const previousPage = this.lastPage ?? undefined
    if (page) {
      this.lastPage = page
    }

    // Exact match by visit UUID; for id-less navigates (history restores), fall
    // back to the most recent in-flight record that can actually receive a
    // navigate: deferred reloads' navigates always carry their own id in 3.4,
    // and prefetch requests never receive a navigate at all.
    let record = this.resolveByUuid(visitId)
    if (!record && !visitId) {
      record = this.resolveInFlight({ excludeDeferred: true, excludePrefetch: true })
      if (record) event.heuristic = true
    }

    // No matching visit: the initial page load, a history restore, or the
    // navigate that router.push() fires just before its clientVisit event
    // (handleClientVisit converts the record when that follows).
    if (!record && page) {
      const recordId = this.nextVisitId++
      record = {
        visitId: recordId,
        inertiaVisitId: visitId,
        type: 'full',
        method: 'GET',
        url: page.url ?? '/',
        // True initial load (no prior page state) keeps the startedAt-0 marker
        // and the initial flag; mid-session synthetic records (history
        // restores) use real timestamps so they sort correctly.
        startedAt: previousPage ? event.timestamp : 0,
        initial: previousPage ? undefined : true,
        finishedAt: event.timestamp,
        duration: 0,
        events: [],
        features: [],
        diagnostics: [],
        cancelled: false,
        interrupted: false,
        completed: true,
        page,
        previousPage,
      }
      this.insertRecord(record)
      if (visitId) this.uuidMap.set(visitId, recordId)

      // On initial page load, deferred before-events may have fired before
      // this navigate event. Link orphaned deferred records to this parent
      // and set their previousPage to the initial page state.
      for (const r of this.records.values()) {
        if (r.type === 'deferred' && r.parentVisitId === undefined) {
          r.parentVisitId = recordId
          r.previousPage = page
        }
      }
    }

    if (!record) return null

    record.events.push(event)

    // navigate fires with cached: true when the page was served from the
    // prefetch cache — such visits never receive start/finish.
    if (detail.cached === true) {
      record.cached = true
    }

    if (page) {
      record.page = page
      record.features = extractFeatures(record, page)
    }

    // Navigate means the page transition is complete. For cache-served visits,
    // inertia:start/finish never fire (no request), so finalize the record here.
    if (!record.finishedAt) {
      record.finishedAt = event.timestamp
      record.duration = event.timestamp - record.startedAt
      record.completed = true
    }

    record.diagnostics = computeDiagnostics(record)

    return record
  }

  /**
   * beforeUpdate fires before navigate and carries the page object (no visit id).
   * It serves page-state bookkeeping (lastPage, deferred previousPage snapshots)
   * and event attachment only — the record's own page comes from the exact-id
   * navigate or success/error events.
   */
  private handleBeforeUpdate(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    const page = detail.page as InertiaPage | undefined

    // Page-state bookkeeping runs regardless of which record the event attaches to.
    if (page) {
      // Snapshot current lastPage as previousPage for all pending deferred records
      // BEFORE updating lastPage. This ensures each deferred record's previousPage
      // reflects the state just before its own response merged in.
      if (this.lastPage) {
        for (const r of this.records.values()) {
          if (r.type === 'deferred' && !r.page) {
            r.previousPage = this.lastPage
          }
        }
      }

      this.lastPage = page
    }

    // beforeUpdate carries no visit id. Attach to the in-flight non-deferred
    // record — deferred records receive their page via their own id-carrying
    // navigate (or at finish).
    const record = this.resolveInFlight({ excludeDeferred: true })
    if (!record) return null

    event.heuristic = true
    record.events.push(event)

    // Deliberately do NOT set record.page here: attribution is a guess, and
    // with two concurrent async visits this beforeUpdate can belong to a
    // different visit than the newest in-flight record — pinning its page on
    // the wrong record would stick (replace visits never get a correcting
    // navigate). The page arrives via an exact-id event instead: navigate, or
    // success/error for replace flows where navigate never fires.
    return record
  }

  /**
   * Client-side visit (router.push/replace/replaceProp/appendToProp/prependToProp).
   * Fires inertia:clientVisit with { page, replace, visitId } — no HTTP request,
   * no other lifecycle events. Creates a completed 'client' record with the page diff.
   */
  private handleClientVisit(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    const page = detail.page as InertiaPage | undefined
    if (!page) return null

    const inertiaVisitId = typeof detail.visitId === 'string' ? detail.visitId : undefined
    const method = detail.replace === true ? 'REPLACE' : 'PUSH'

    // router.push() (replace: false) fires inertia:navigate with this visit's id
    // BEFORE inertia:clientVisit — handleNavigate already created a synthetic
    // record for it. Convert that record in place instead of duplicating it;
    // its previousPage (snapshotted pre-navigate) is the correct diff baseline.
    const existing = this.resolveByUuid(inertiaVisitId)
    if (existing) {
      existing.type = 'client'
      existing.method = method
      existing.url = page.url ?? existing.url
      existing.events.push(event)
      existing.page = page
      existing.features = this.extractPageFeatures(page)
      existing.completed = true
      if (!existing.finishedAt) {
        existing.finishedAt = event.timestamp
        existing.duration = 0
      }
      this.lastPage = page
      return existing
    }

    const visitId = this.nextVisitId++

    const record: RequestRecord = {
      visitId,
      inertiaVisitId,
      type: 'client',
      method,
      url: page.url ?? '/',
      startedAt: event.timestamp,
      finishedAt: event.timestamp,
      duration: 0,
      events: [event],
      features: this.extractPageFeatures(page),
      diagnostics: [],
      cancelled: false,
      interrupted: false,
      completed: true,
      page,
      previousPage: this.lastPage ?? undefined,
    }

    this.insertRecord(record)
    if (inertiaVisitId) this.uuidMap.set(inertiaVisitId, visitId)
    this.lastPage = page

    return record
  }

  private handleGenericEvent(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    const record = this.resolveEventRecord(event, detail)
    if (!record) return null

    record.events.push(event)

    // success/error carry the post-swap page (page.get()) alongside an exact
    // visitId — an authoritative page source that overwrites anything a
    // fallback attributed. navigate (also exact-id) delivers the same page
    // object, so last-writer-wins is harmless; for replace visits
    // (POST→same-URL) where navigate never fires, this is the only exact-id
    // page source.
    if (event.name === 'inertia:success' || event.name === 'inertia:error') {
      const page = detail.page as InertiaPage | undefined
      if (page) {
        record.page = page
        record.features = extractFeatures(record, page)
      }
    }

    // Extract status/errors from outcome events
    if (event.name === 'inertia:error') {
      record.error = detail.errors
    } else if (event.name === 'inertia:httpException') {
      const response = detail.response as Record<string, unknown> | undefined
      // The visit failed whether or not the event carried a response payload —
      // httpException is the only failure signal for non-Inertia responses
      // (networkError covers transport failures). No page ever merged.
      record.failed = true
      if (response) {
        if (typeof response.status === 'number') {
          record.status = response.status
          record.error = `HTTP ${response.status}`
        }

        // Response interceptors fire only for Inertia responses that reach setPage — for
        // exceptions the event payload is the only source of wire data.
        record.wire = { ...record.wire, response: this.wireResponseFromPayload(response, event.timestamp) }

        // 409 means a server-initiated redirect (version mismatch or inertia_location).
        // The client will do a full page reload — no inertia:navigate fires.
        if (record.status === 409) {
          record.type = 'redirect'
          const headers = response.headers as Record<string, string> | undefined
          if (headers) {
            record.redirectUrl = headers['x-inertia-location'] ?? headers['x-inertia-redirect']
          }
        }
      }
    } else if (event.name === 'inertia:networkError') {
      record.error = detail.error
      record.failed = true
    } else if (event.name === 'inertia:location') {
      // Inertia >= 3.6: fires just before the forced full-page reload (409
      // version mismatch or inertia_location redirect). No visit id — it
      // reaches the still-unfinished 409 visit via the in-flight fallback,
      // possibly after httpException already marked it, never as a new record.
      record.type = 'redirect'
      const url = detail.url
      if (url instanceof URL) {
        record.redirectUrl = url.pathname + url.search
      } else if (typeof url === 'string') {
        record.redirectUrl = normalizeUrl(url)
      }
    } else if (event.name === 'inertia:prefetched') {
      // Prefetch responses bypass the response interceptor (handlePrefetch
      // returns before setPage) — capture wire data from the event instead.
      const response = detail.response as Record<string, unknown> | undefined
      if (response && !record.wire?.response) {
        record.wire = { ...record.wire, response: this.wireResponseFromPayload(response, event.timestamp) }
        if (record.status === undefined && typeof response.status === 'number') {
          record.status = response.status
        }
      }
    }

    record.diagnostics = computeDiagnostics(record)

    return record
  }

  /** Resolve the record an event belongs to, by id when available, by fallback otherwise. */
  private resolveEventRecord(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    // success/error carry a top-level visitId; prefetching/prefetched carry the visit object.
    const visit = this.extractVisit(detail)
    const uuid = visitUuid(visit) ?? (typeof detail.visitId === 'string' ? detail.visitId : undefined)

    // An explicit id resolves exactly or not at all — attaching an id-carrying
    // event to an unrelated record (e.g. after eviction) would be misattribution.
    if (uuid) return this.resolveByUuid(uuid)

    // flash can fire with no visit in flight at all (router.flash()) — fall back
    // to the most recent record so the flash is still visible somewhere sensible.
    const record =
      event.name === 'inertia:flash'
        ? (this.resolveInFlight() ?? this.sortedRecords[this.sortedRecords.length - 1] ?? null)
        : this.resolveInFlight()
    if (record) event.heuristic = true
    return record
  }

  /**
   * Create a prefetch record when inertia:start confirms a real request was made.
   * The beforeEvent was deferred from handleBefore; startEvent is the current inertia:start.
   */
  private createPrefetchRecord(
    visit: InertiaVisitDetail,
    uuid: string,
    beforeEvent: CapturedEvent,
    startEvent: CapturedEvent,
    timestamp: number,
  ): RequestRecord {
    const visitId = this.nextVisitId++
    const method = (visit.method ?? 'GET').toUpperCase()
    const url = this.extractUrl(visit)

    const only = visit.only?.length ? visit.only : undefined
    const except = visit.except?.length ? visit.except : undefined

    const record: RequestRecord = {
      visitId,
      inertiaVisitId: uuid,
      type: 'prefetch',
      method,
      url,
      only,
      except,
      startedAt: timestamp,
      events: [beforeEvent, startEvent],
      features: [{ type: 'prefetch', label: 'PREFETCH' }],
      diagnostics: [],
      cancelled: false,
      interrupted: false,
      completed: false,
    }

    this.insertRecord(record)
    this.uuidMap.set(uuid, visitId)
    return record
  }

  // --- Resolution helpers ---

  private resolveByUuid(uuid: string | undefined): RequestRecord | null {
    if (!uuid) return null
    const visitId = this.uuidMap.get(uuid)
    if (visitId === undefined) return null
    return this.records.get(visitId) ?? null
  }

  /**
   * Fallback for events that carry no visit id: the most recently started
   * record that has not finished yet.
   */
  private resolveInFlight(options?: { excludeDeferred?: boolean; excludePrefetch?: boolean }): RequestRecord | null {
    for (let i = this.sortedRecords.length - 1; i >= 0; i--) {
      const r = this.sortedRecords[i]
      if (r.finishedAt != null) continue
      if (options?.excludeDeferred && r.type === 'deferred') continue
      if (options?.excludePrefetch && r.type === 'prefetch') continue
      return r
    }
    return null
  }

  // --- Record management ---

  /**
   * Insert a record into both the Map and the sorted array.
   * Records arrive roughly chronologically, so we scan backwards (typically O(1)).
   */
  private insertRecord(record: RequestRecord): void {
    this.records.set(record.visitId, record)

    // Insertion sort: find correct position scanning from end
    let i = this.sortedRecords.length - 1
    while (
      i >= 0 &&
      (this.sortedRecords[i].startedAt > record.startedAt ||
        (this.sortedRecords[i].startedAt === record.startedAt && this.sortedRecords[i].visitId > record.visitId))
    ) {
      i--
    }
    this.sortedRecords.splice(i + 1, 0, record)

    // Evict oldest completed record if over capacity
    if (this.sortedRecords.length > this.maxRecords) {
      this.evictOldest()
    }
  }

  private evictOldest(): void {
    for (let i = 0; i < this.sortedRecords.length; i++) {
      const r = this.sortedRecords[i]
      if (r.finishedAt != null) {
        this.sortedRecords.splice(i, 1)
        this.deleteRecord(r)
        return
      }
    }
    // If no completed records, evict the oldest regardless
    const oldest = this.sortedRecords.shift()
    if (oldest) {
      this.deleteRecord(oldest)
    }
  }

  private deleteRecord(record: RequestRecord): void {
    this.records.delete(record.visitId)
    if (record.inertiaVisitId) this.uuidMap.delete(record.inertiaVisitId)
    this._evictedCount++
  }

  /** Build WireResponseData from an event payload's { status, data, headers }. */
  private wireResponseFromPayload(response: Record<string, unknown>, timestamp: number): WireResponseData {
    return {
      status: typeof response.status === 'number' ? response.status : undefined,
      headers: redactHeaders({ ...(response.headers as Record<string, string> | undefined) }),
      bodySize: wireBodySize(response.data),
      finishedAt: timestamp,
    }
  }

  // --- Visit extraction helper ---

  private extractVisit(detail: Record<string, unknown>): InertiaVisitDetail | undefined {
    const visit = detail.visit
    if (visit == null || typeof visit !== 'object') return undefined
    return visit as InertiaVisitDetail
  }

  /**
   * Extract visit options worth displaying from the visit detail.
   * Omits internal/noise fields and default/empty values.
   */
  private extractVisitOptions(visit: InertiaVisitDetail): Record<string, unknown> | undefined {
    const skip = new Set([
      'id',
      'method',
      'url',
      'href',
      'cancelToken',
      'signal',
      'only',
      'except',
      'deferredProps',
      'completed',
      'cancelled',
      'interrupted',
      'prefetch',
      'poll',
    ])
    const opts: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(visit)) {
      if (skip.has(k)) continue
      if (v === false || v === undefined || v === null) continue
      if (Array.isArray(v) && v.length === 0) continue
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) continue
      opts[k] = v
    }
    // `data` is the raw request body and `headers` the caller's headers — both
    // routinely carry credentials, and both reach the clipboard via the export.
    return Object.keys(opts).length > 0 ? (redactDeep(opts) as Record<string, unknown>) : undefined
  }

  // --- Classification helpers ---

  private classifyVisitType(visit: InertiaVisitDetail | undefined): VisitType {
    if (!visit) return 'full'

    // Inertia >= 3.6 marks router.poll() traffic. Poll wins over partial —
    // it's the distinguishing marker for the list; only/except stay captured.
    if (visit.poll === true) return 'poll'

    const only = visit.only
    const except = visit.except
    if ((only && only.length > 0) || (except && except.length > 0)) {
      return 'partial'
    }

    if (visit.prefetch) return 'prefetch'

    return 'full'
  }

  private extractUrl(visit: InertiaVisitDetail | undefined): string {
    if (!visit) return '(unknown)'
    const url = visit.url
    if (url instanceof URL) return url.pathname + url.search
    // Inertia hands us a URL instance, but events reach the correlator through
    // the store, whose safeClone has already stringified it to an ABSOLUTE url.
    // So this is the branch production actually takes — normalizing it keeps
    // `url` in the same shape as `redirectUrl` and as the URL-object branch,
    // instead of the two sitting side by side in different formats.
    if (typeof url === 'string') return normalizeUrl(url)
    return '(unknown)'
  }

  private isDeferredReload(visit: InertiaVisitDetail): boolean {
    return visit.deferredProps === true
  }

  private findParentVisitId(url: string): number | undefined {
    // Find the most recent non-deferred request to the same URL
    for (let i = this.sortedRecords.length - 1; i >= 0; i--) {
      const req = this.sortedRecords[i]
      if (req.url === url && req.type !== 'deferred' && req.type !== 'prefetch') {
        return req.visitId
      }
    }
    return undefined
  }

  // --- Feature extraction ---

  /**
   * Extract page-level features (excludes request-specific: partial, prefetch, cached).
   * Delegates to the standalone extractPageFeatures function from features.ts.
   */
  extractPageFeatures(page: InertiaPage): ActiveFeature[] {
    return extractPageFeatures(page)
  }
}
