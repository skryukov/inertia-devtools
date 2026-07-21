import { Correlator } from './correlator'
import type { InertiaPage, InertiaEventName } from './protocol'
import type {
  ActiveFeature,
  CapturedEvent,
  RequestRecord,
  DevToolsState,
  DevToolsOptions,
  DocsProvider,
  NetworkCaptureMode,
  SessionRequestSummary,
  WireRequestData,
  WireResponseData,
} from './types'
import type { NetworkTiming } from './network'
import { saveSession, loadSession, clearSession } from './session'
import { TOO_DEEP } from './utils'

const MAX_CLONE_DEPTH = 10

type Subscriber = (state: DevToolsState) => void

/**
 * Central state store for the devtools.
 * Framework-agnostic: exposes a subscribe() pattern for any UI to consume.
 */
export class DevToolsStore {
  private correlator: Correlator
  private subscribers: Set<Subscriber> = new Set()
  private nextEventId = 1
  private tick = 0
  private panelOpen = false
  private options: DevToolsOptions
  private previousSession: ReturnType<typeof loadSession> = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private networkCaptureMode: NetworkCaptureMode = 'pending'
  private legacyInertiaWarned = false

  constructor(options: DevToolsOptions = {}) {
    this.options = options
    this.correlator = new Correlator()
    this.previousSession = loadSession()
  }

  // --- Public state ---

  get requests(): RequestRecord[] {
    return this.correlator.getRequests().slice()
  }

  get currentPage(): InertiaPage | null {
    return this.correlator.getCurrentPage()
  }

  getRequest(visitId: number): RequestRecord | undefined {
    return this.correlator.getRequest(visitId)
  }

  getPageFeatures(page: InertiaPage): ActiveFeature[] {
    return this.correlator.extractPageFeatures(page)
  }

  get docsProvider(): DocsProvider {
    return this.options.docsProvider ?? 'inertiajs'
  }

  isInertiaRequestUrl(url: string): boolean {
    return this.correlator.hasRequestWithUrl(url)
  }

  get evictedCount(): number {
    return this.correlator.evictedCount
  }

  get previousSessionRequests(): SessionRequestSummary[] {
    return this.previousSession?.requests ?? []
  }

  /** Router actions (replay/reload) are available — a router was provided. */
  get canAct(): boolean {
    return this.options.router != null
  }

  getState(): DevToolsState {
    return {
      requests: this.requests,
      currentPage: this.currentPage,
      evictedCount: this.evictedCount,
      networkCaptureMode: this.networkCaptureMode,
      tick: this.tick,
    }
  }

  // --- Panel state ---

  setPanelOpen(open: boolean): void {
    this.panelOpen = open
  }

  isPanelOpen(): boolean {
    return this.panelOpen
  }

  // --- Event capture ---

  /**
   * Capture a DOM event (inertia:*).
   * Called by capture.ts event handlers, one microtask after dispatch — the
   * timestamp is passed in from capture time, and defaultPrevented is final
   * here because every document listener has already run.
   */
  captureEvent(name: InertiaEventName, event: Event, timestamp = performance.now()): void {
    if (!(event instanceof CustomEvent)) return
    const rawDetail = event.detail
    const detail = this.safeSerializeDetail(rawDetail)

    this.warnOnceOnLegacyInertia(detail)

    const captured: CapturedEvent = {
      id: this.nextEventId++,
      name,
      timestamp,
      detail,
    }
    if (name === 'inertia:before' && event.defaultPrevented) {
      captured.prevented = true
    }

    this.correlator.processEvent(captured)
    this.notify()
  }

  /**
   * Capture a network timing entry (from PerformanceObserver) and correlate it.
   * Unmatched entries are buffered inside the correlator and drained on finish,
   * which notifies on its own — no need to re-render for a buffered miss.
   */
  captureNetworkTiming(timing: NetworkTiming): void {
    if (this.correlator.linkNetworkTiming(timing)) {
      this.notify()
    }
  }

  // --- Wire data (interceptors) ---

  setNetworkCaptureMode(mode: NetworkCaptureMode): void {
    if (this.networkCaptureMode === mode) return
    this.networkCaptureMode = mode
    this.notify()
  }

  /**
   * Attach request wire data (from the request interceptor) by Inertia visit UUID.
   * No notify: these run synchronously inside the host app's request chain, and
   * lifecycle events that always follow (finish/success/prefetched/httpException)
   * notify on their own — the wire data rides that re-render.
   */
  attachWireRequest(inertiaVisitId: string, request: WireRequestData): void {
    this.correlator.attachWireRequest(inertiaVisitId, request)
  }

  /** Attach response wire data (from the response interceptor) by Inertia visit UUID. */
  attachWireResponse(inertiaVisitId: string, response: WireResponseData): void {
    this.correlator.attachWireResponse(inertiaVisitId, response)
  }

  // --- Subscription ---

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  // --- Actions ---

  clear(): void {
    this.correlator.clear()
    this.nextEventId = 1
    clearSession()
    this.previousSession = null
    this.notify()
  }

  /**
   * Re-issue a captured visit through the app's router. GET only — replaying
   * a mutation would re-submit it, so non-GET records are silently refused
   * (the UI gates too; this guard is the safety net). No-ops without a
   * router or a matching record.
   */
  replayVisit(visitId: number): void {
    const router = this.options.router
    if (!router) return
    const record = this.correlator.getRequest(visitId)
    if (!record) return
    if (record.method.toUpperCase() !== 'GET') return
    try {
      router.visit(record.url, {
        method: record.method.toLowerCase(),
        only: record.only,
        except: record.except,
        headers: undefined,
      })
    } catch (e) {
      console.warn('[inertia-devtools] Replay failed:', e)
    }
  }

  /** Reload the current page through the app's router. No-ops without a router. */
  reload(): void {
    const router = this.options.router
    if (!router) return
    try {
      router.reload({})
    } catch (e) {
      console.warn('[inertia-devtools] Reload failed:', e)
    }
  }

  /**
   * Flush the debounced session save immediately. Called on pagehide —
   * a 409/inertia:location hard reload lands inside the debounce window,
   * which would otherwise lose exactly the record that explains the reload.
   */
  flushPendingSave(): void {
    if (this.saveTimer === undefined) return
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    saveSession(this.requests)
  }

  // --- Internal ---

  /**
   * Correlation requires the visit UUID introduced in Inertia 3.4.
   * A visit-carrying event without one means the app runs an older Inertia —
   * warn once and point at the legacy devtools line.
   */
  private warnOnceOnLegacyInertia(detail: Record<string, unknown>): void {
    if (this.legacyInertiaWarned) return
    const visit = detail.visit
    if (visit == null || typeof visit !== 'object') return
    if (typeof (visit as Record<string, unknown>).id === 'string') return

    this.legacyInertiaWarned = true
    console.warn(
      '[inertia-devtools] Inertia events carry no visit id — request correlation will be unreliable. ' +
        'This version supports Inertia >= 3.4 (for v2 / v3.0–3.3 use inertia-devtools@0.1); ' +
        'on a newer Inertia, check for an inertia-devtools update.',
    )
  }

  private notify(): void {
    this.tick++
    const state = this.getState()
    for (const fn of this.subscribers) {
      try {
        fn(state)
      } catch (e) {
        console.warn('[inertia-devtools] Subscriber error:', e)
      }
    }

    // Debounced save to sessionStorage
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => saveSession(this.requests), 1000)
  }

  /**
   * Safely serialize event detail, converting non-serializable values.
   */
  private safeSerializeDetail(detail: unknown): Record<string, unknown> {
    if (detail == null) return {}
    if (typeof detail !== 'object') return { value: detail }

    try {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
        // Page objects are server JSON (acyclic, no functions): native
        // structuredClone copies them at full depth and is cheaper than the
        // recursive walk — this runs synchronously at navigation commit, and
        // the depth cap would otherwise truncate deep props (see TOO_DEEP).
        if (key === 'page' && value != null && typeof value === 'object') {
          try {
            result[key] = structuredClone(value)
            continue
          } catch {
            // Non-cloneable value snuck in — fall through to the safe walk
          }
        }
        result[key] = this.safeClone(value)
      }
      return result
    } catch {
      return {}
    }
  }

  private safeClone(value: unknown, depth = MAX_CLONE_DEPTH): unknown {
    if (value == null || typeof value !== 'object') return value

    if (depth <= 0) return TOO_DEEP

    // URL objects
    if (value instanceof URL) return value.toString()

    // Error objects
    if (value instanceof Error) {
      return { message: value.message, name: value.name, stack: value.stack }
    }

    // Arrays
    if (Array.isArray(value)) {
      return value.map((v) => this.safeClone(v, depth - 1))
    }

    // Plain objects -- shallow clone to avoid circular refs
    try {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        // Skip functions and circular-prone properties
        if (typeof v === 'function') continue
        if (k === 'cancelToken' || k === 'signal') continue
        result[k] = this.safeClone(v, depth - 1)
      }
      return result
    } catch {
      return String(value)
    }
  }
}
