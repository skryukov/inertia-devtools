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
   * Called by capture.ts event handlers.
   */
  captureEvent(name: InertiaEventName, event: Event): void {
    if (!(event instanceof CustomEvent)) return
    const rawDetail = event.detail
    const detail = this.safeSerializeDetail(rawDetail)

    const captured: CapturedEvent = {
      id: this.nextEventId++,
      name,
      timestamp: performance.now(),
      detail,
    }

    this.correlator.processEvent(captured)
    this.notify()
  }

  /**
   * Capture a network timing entry (from PerformanceObserver) and correlate it.
   */
  captureNetworkTiming(timing: NetworkTiming): void {
    this.correlator.linkNetworkTiming(timing)
    this.notify()
  }

  // --- Wire data (interceptors) ---

  setNetworkCaptureMode(mode: NetworkCaptureMode): void {
    if (this.networkCaptureMode === mode) return
    this.networkCaptureMode = mode
    this.notify()
  }

  /** Attach request wire data (from the request interceptor) by Inertia visit UUID. */
  attachWireRequest(inertiaVisitId: string, request: WireRequestData): void {
    if (this.correlator.attachWireRequest(inertiaVisitId, request)) {
      this.notify()
    }
  }

  /** Attach response wire data (from the response interceptor) by Inertia visit UUID. */
  attachWireResponse(inertiaVisitId: string, response: WireResponseData): void {
    if (this.correlator.attachWireResponse(inertiaVisitId, response)) {
      this.notify()
    }
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

  // --- Internal ---

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
        result[key] = this.safeClone(value)
      }
      return result
    } catch {
      return {}
    }
  }

  private safeClone(value: unknown, depth = MAX_CLONE_DEPTH): unknown {
    if (value == null || typeof value !== 'object') return value

    if (depth <= 0) return '[too deep]'

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
