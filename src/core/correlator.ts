import type { InertiaPage } from './protocol'
import type { CapturedEvent, RequestRecord, ActiveFeature, VisitType, InertiaVisitDetail } from './types'
import type { NetworkTiming } from './network'
import { extractFeatures, extractPageFeatures } from './features'
import { computeDiagnostics } from './diagnostics'
import { normalizeUrl } from './url'

const MAX_PENDING_NETWORK = 10
const NETWORK_TIMING_TOLERANCE_MS = 2000

/**
 * Correlates individual Inertia events into logical RequestRecords.
 *
 * Strategy:
 * - `before`/`start`/`finish` carry event.detail.visit with matching properties
 *   → use visit fingerprint (url + method + only + deferredProps) for correlation
 * - Other events (navigate, success, etc.) → correlate via "active visit ID"
 * - Prefetch visits: `inertia:before` fires even for cache hits (no real request).
 *   We defer record creation until `inertia:start` to avoid phantom records.
 *
 * Note: Inertia creates NEW visit objects for each event dispatch (before/start/finish
 * have different object references), so identity-based WeakMap correlation won't work.
 */
export class Correlator {
  private nextVisitId = 1
  private records: Map<number, RequestRecord> = new Map()
  private sortedRecords: RequestRecord[] = []
  private maxRecords: number
  /**
   * Maps visit fingerprint → queue of visit IDs.
   * A queue handles concurrent requests with the same fingerprint (rare but possible).
   * FIFO: before pushes to back, finish shifts from front.
   */
  private fingerprintMap: Map<string, number[]> = new Map()
  /** Most recent prefetch before-event awaiting confirmation (inertia:start). Cache hits never get start. */
  private pendingPrefetch: { event: CapturedEvent; timestamp: number; url: string; fingerprint: string } | null = null
  private activeVisitId: number | null = null
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

  /**
   * Process a client-side visit detected by history API interception.
   * Creates a new RequestRecord of type 'client' with the page diff.
   */
  processClientVisit(method: 'push' | 'replace', page: InertiaPage, previousPage: InertiaPage): RequestRecord {
    const visitId = this.nextVisitId++
    const now = performance.now()

    const record: RequestRecord = {
      visitId,
      type: 'client',
      method: method === 'push' ? 'PUSH' : 'REPLACE',
      url: page.url ?? '/',
      startedAt: now,
      finishedAt: now,
      duration: 0,
      events: [],
      features: this.extractPageFeatures(page),
      diagnostics: [],
      cancelled: false,
      interrupted: false,
      completed: true,
      page,
      previousPage,
    }

    this.insertRecord(record)
    this.lastPage = page
    this.activeVisitId = visitId

    return record
  }

  clear(): void {
    this.records.clear()
    this.sortedRecords = []
    this.fingerprintMap.clear()
    this.pendingPrefetch = null
    this.pendingNetwork = []
    this._evictedCount = 0
    this.activeVisitId = null
    this.nextVisitId = 1
    // Note: lastPage is NOT cleared -- it represents the current app state
  }

  /**
   * Link a network timing entry (from PerformanceObserver) to a visit.
   * Returns the matched RequestRecord, or null if no match found.
   */
  linkNetworkTiming(timing: NetworkTiming): RequestRecord | null {
    const match = this.findNetworkMatch(timing)
    if (match) {
      match.network = timing
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
        record.network = net
        this.pendingNetwork.splice(i, 1)
        return
      }
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
    const fingerprint = this.visitFingerprint(visit)

    // Prefetch visits: inertia:before fires even for cache hits (no real request).
    // Defer record creation until inertia:start confirms a real request was made.
    if (visit && visit.prefetch) {
      this.pendingPrefetch = { event, timestamp, url: this.extractUrl(visit), fingerprint }
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

    this.insertRecord(record)

    // Store fingerprint → visitId for correlation with start/finish events
    this.pushFingerprint(fingerprint, visitId)

    // Deferred requests are background reloads — they must NOT steal
    // activeVisitId from the parent visit, which still needs to receive
    // navigate/beforeUpdate events that fire after deferred starts.
    // On initial page load, deferred before-events fire BEFORE navigate,
    // so activeVisitId must stay null to let navigate create the initial record.
    if (!isDeferred) {
      this.activeVisitId = visitId
    }
    return record
  }

  private handleStart(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    // Check if this is a pending prefetch visit (deferred from handleBefore).
    // before → start fire in rapid succession for the same visit.
    const visit = this.extractVisit(detail)
    if (this.pendingPrefetch && visit) {
      const fingerprint = this.visitFingerprint(visit)
      if (fingerprint === this.pendingPrefetch.fingerprint) {
        const pending = this.pendingPrefetch
        this.pendingPrefetch = null
        return this.createPrefetchRecord(visit, pending.event, event, pending.timestamp)
      }
    }

    const record = this.resolveByFingerprint(event) ?? this.resolveByActiveId()
    if (record) {
      record.events.push(event)
    }
    return record
  }

  private handleFinish(event: CapturedEvent, detail: Record<string, unknown>, timestamp: number): RequestRecord | null {
    const record = this.resolveByFingerprint(event) ?? this.resolveByActiveId()
    if (!record) return null

    record.events.push(event)
    record.finishedAt = timestamp
    record.duration = timestamp - record.startedAt

    const visit = this.extractVisit(detail)
    if (visit) {
      record.completed = !!visit.completed
      record.cancelled = !!visit.cancelled
      record.interrupted = !!visit.interrupted
    }

    // Try to match any pending network records to this visit
    if (!record.network) {
      this.drainPendingNetwork(record)
    }

    // Deferred requests don't receive navigate/beforeUpdate events (those go to
    // the parent visit). By finish time, lastPage has been updated with the merged
    // props, so we capture it here for the props diff view.
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

    // Update global page state
    if (page) {
      this.lastPage = page
    }

    let record = this.resolveByActiveId()

    // Initial page load: navigate fires with no preceding before/start
    if (!record && page) {
      const visitId = this.nextVisitId++
      record = {
        visitId,
        type: 'full',
        method: 'GET',
        url: page.url ?? '/',
        startedAt: 0,
        finishedAt: event.timestamp,
        duration: 0,
        events: [],
        features: [],
        diagnostics: [],
        cancelled: false,
        interrupted: false,
        completed: true,
        page,
      }
      this.insertRecord(record)
      this.activeVisitId = visitId

      // On initial page load, deferred before-events may have fired before
      // this navigate event. Link orphaned deferred records to this parent
      // and set their previousPage to the initial page state.
      for (const r of this.records.values()) {
        if (r.type === 'deferred' && r.parentVisitId === undefined) {
          r.parentVisitId = visitId
          r.previousPage = page
        }
      }
    }

    if (!record) return null

    record.events.push(event)

    if (page) {
      record.page = page
      record.features = extractFeatures(record, page)
    }

    // Navigate means the page transition is complete. For prefetch cache hits,
    // inertia:start/finish never fire (no XHR), so finalize the record here.
    if (!record.finishedAt) {
      record.finishedAt = event.timestamp
      record.duration = event.timestamp - record.startedAt
      record.completed = true
    }

    record.diagnostics = computeDiagnostics(record)

    return record
  }

  /**
   * beforeUpdate fires before navigate and carries the page object.
   * For POST→redirect flows, navigate never fires (replace=true),
   * so beforeUpdate is the only source of page data.
   */
  private handleBeforeUpdate(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    const record = this.resolveByActiveId()
    if (!record) return null

    record.events.push(event)

    const page = detail.page as InertiaPage | undefined
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

      // Only set page on the record if navigate hasn't already set it.
      // For normal visits, navigate fires after beforeUpdate and takes precedence.
      // For POST→redirect, navigate never fires — beforeUpdate is the only source.
      if (!record.page) {
        record.page = page
        record.features = extractFeatures(record, page)
      }
    }

    return record
  }

  private handleGenericEvent(event: CapturedEvent, detail: Record<string, unknown>): RequestRecord | null {
    const record = this.resolveByFingerprint(event) ?? this.resolveByActiveId()
    if (!record) return null

    record.events.push(event)

    // Extract status/errors from outcome events
    if (event.name === 'inertia:error') {
      record.error = detail.errors
    } else if (event.name === 'inertia:httpException') {
      const response = detail.response as Record<string, unknown> | undefined
      if (response) {
        record.status = response.status as number

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
    }

    record.diagnostics = computeDiagnostics(record)

    return record
  }

  /**
   * Create a prefetch record when inertia:start confirms a real request was made.
   * The beforeEvent was deferred from handleBefore; startEvent is the current inertia:start.
   */
  private createPrefetchRecord(
    visit: InertiaVisitDetail,
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
    // Store fingerprint for finish event correlation
    const fingerprint = this.visitFingerprint(visit)
    this.pushFingerprint(fingerprint, visitId)
    this.activeVisitId = visitId
    return record
  }

  // --- Resolution helpers ---

  /**
   * Create a visit fingerprint from event detail for correlation.
   * Uses url + method + only + deferredProps to uniquely identify a visit.
   */
  private visitFingerprint(visit: InertiaVisitDetail | undefined): string {
    if (!visit) return '(no-visit)'
    const url = this.extractUrl(visit)
    const method = (visit.method ?? 'GET').toUpperCase()
    const only = JSON.stringify(visit.only ?? [])
    const except = JSON.stringify(visit.except ?? [])
    const deferred = visit.deferredProps ? 'd' : ''
    const prefetch = visit.prefetch ? 'p' : ''
    return `${url}|${method}|${only}|${except}|${deferred}|${prefetch}`
  }

  private pushFingerprint(fingerprint: string, visitId: number): void {
    const queue = this.fingerprintMap.get(fingerprint)
    if (queue) {
      queue.push(visitId)
    } else {
      this.fingerprintMap.set(fingerprint, [visitId])
    }
  }

  private removeFromFingerprintMap(visitId: number): void {
    for (const [fingerprint, queue] of this.fingerprintMap) {
      const idx = queue.indexOf(visitId)
      if (idx !== -1) {
        queue.splice(idx, 1)
        if (queue.length === 0) this.fingerprintMap.delete(fingerprint)
        return
      }
    }
  }

  /**
   * Resolve a record by visit fingerprint. Uses FIFO order (first before → first start).
   * Peeks at the front of the queue without removing; finish will clean up.
   */
  private resolveByFingerprint(event: CapturedEvent): RequestRecord | null {
    const visit = this.extractVisit(event.detail)
    if (!visit) return null

    const fingerprint = this.visitFingerprint(visit)
    const queue = this.fingerprintMap.get(fingerprint)
    if (!queue || queue.length === 0) return null

    // For finish events, consume (shift) the entry since the visit is complete
    if (event.name === 'inertia:finish') {
      const visitId = queue.shift()!
      if (queue.length === 0) {
        this.fingerprintMap.delete(fingerprint)
      }
      return this.records.get(visitId) ?? null
    }

    // For start and other events, peek at the first entry
    return this.records.get(queue[0]) ?? null
  }

  private resolveByActiveId(): RequestRecord | null {
    if (this.activeVisitId === null) return null
    return this.records.get(this.activeVisitId) ?? null
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
        this.records.delete(r.visitId)
        this.removeFromFingerprintMap(r.visitId)
        this._evictedCount++
        return
      }
    }
    // If no completed records, evict the oldest regardless
    const oldest = this.sortedRecords.shift()
    if (oldest) {
      this.records.delete(oldest.visitId)
      this.removeFromFingerprintMap(oldest.visitId)
      this._evictedCount++
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
    ])
    const opts: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(visit)) {
      if (skip.has(k)) continue
      if (v === false || v === undefined || v === null) continue
      if (Array.isArray(v) && v.length === 0) continue
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) continue
      opts[k] = v
    }
    return Object.keys(opts).length > 0 ? opts : undefined
  }

  // --- Classification helpers ---

  private classifyVisitType(visit: InertiaVisitDetail | undefined): VisitType {
    if (!visit) return 'full'

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
    if (typeof url === 'string') return url
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
