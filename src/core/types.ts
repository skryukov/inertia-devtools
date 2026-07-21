import type { PendingVisit } from '@inertiajs/core'
import type { InertiaPage, InertiaEventName } from './protocol'
import type { NetworkTiming } from './network'

export type StopFunction = () => void

/**
 * A captured event with timestamp and serialized payload.
 */
export interface CapturedEvent {
  id: number
  name: InertiaEventName
  timestamp: number // performance.now()
  detail: Record<string, unknown>
  /** inertia:before only: a listener called preventDefault(), so the visit never started. */
  prevented?: boolean
  /** Attached via the most-recent-in-flight fallback — the event carries no visit id, so attribution is a guess. */
  heuristic?: boolean
}

/**
 * Visit type classification.
 */
export type VisitType = 'full' | 'partial' | 'prefetch' | 'deferred' | 'redirect' | 'client' | 'poll'

/**
 * Active Inertia feature detected on a request.
 */
export interface ActiveFeature {
  type:
    | 'partial'
    | 'deferred'
    | 'merge'
    | 'prepend'
    | 'deep-merge'
    | 'scroll'
    | 'once'
    | 'encrypted'
    | 'clear-history'
    | 'prefetch'
    | 'poll'
    | 'flash'
    | 'remember'
    | 'cached'
  label: string
  details?: Record<string, unknown>
}

/**
 * A logical request (navigation) grouping correlated events.
 */
export interface RequestRecord {
  visitId: number
  /** Inertia's own visit UUID (visit.id / detail.visitId), when the event carried one. */
  inertiaVisitId?: string
  parentVisitId?: number
  type: VisitType
  method: string
  url: string
  only?: string[]
  except?: string[]
  /** Served from the prefetch cache (navigate fired with cached: true). */
  cached?: boolean
  /** An inertia:before listener called preventDefault() — the visit never started. */
  prevented?: boolean
  /** Synthetic record for the initial full-page load (navigate with no prior page state). */
  initial?: boolean
  status?: number
  startedAt: number
  finishedAt?: number
  duration?: number
  page?: InertiaPage
  previousPage?: InertiaPage
  events: CapturedEvent[]
  features: ActiveFeature[]
  cancelled: boolean
  interrupted: boolean
  completed: boolean
  error?: unknown
  /**
   * The response never merged: HTTP exception or network error. Distinct from
   * `error`, which also holds validation errors — those visits DID merge
   * (Inertia fires inertia:error for any page whose merged props carry errors,
   * including partial reloads that merely carried them over).
   */
  failed?: boolean
  redirectUrl?: string
  visitOptions?: Record<string, unknown>
  diagnostics: Diagnostic[]
  network?: NetworkTiming
  wire?: WireData
}

/** Request wire data captured via Inertia's dev-mode interceptors. */
export interface WireRequestData {
  method: string
  url: string
  headers: Record<string, string>
  /** When the request interceptor fired (just before send) — later than the record's before-event startedAt. */
  startedAt: number
}

/**
 * Response wire data. Captured via the response interceptor for Inertia
 * responses; prefetch responses and HTTP exceptions bypass the interceptor
 * and are extracted from the inertia:prefetched / inertia:httpException events.
 */
export interface WireResponseData {
  status?: number
  headers: Record<string, string>
  bodySize?: number
  finishedAt: number
}

/** Actual request/response data from the wire (vs reconstructed client-side). */
export interface WireData {
  request?: WireRequestData
  response?: WireResponseData
}

/**
 * How network data is being captured.
 * - 'pending': interceptor availability not yet determined (no events seen)
 * - 'interceptors': subscribed to window.__inertia_interceptors__ (full wire data)
 * - 'fallback': interceptors unavailable (app sets dev: false) — PerformanceObserver timing only
 */
export type NetworkCaptureMode = 'pending' | 'interceptors' | 'fallback'

/** Severity level for inline diagnostics */
export type DiagnosticSeverity = 'warning' | 'error' | 'info'

/** Inline diagnostic attached to a request */
export interface Diagnostic {
  id: string
  severity: DiagnosticSeverity
  message: string
  /** Optional link to relevant documentation */
  docsUrl?: string
}

/**
 * Snapshot of the devtools state exposed to subscribers.
 */
export interface DevToolsState {
  requests: RequestRecord[]
  currentPage: InertiaPage | null
  evictedCount: number
  networkCaptureMode: NetworkCaptureMode
  /** Monotonically increasing counter; changes on every state update. */
  tick: number
}

/**
 * Visit object from Inertia event details.
 * Extends PendingVisit with an index signature for Object.entries iteration
 * and forward-compatibility with future Inertia versions.
 */
export type InertiaVisitDetail = PendingVisit & Record<string, unknown>

/** Compact request summary for sessionStorage persistence */
export interface SessionRequestSummary {
  visitId: number
  parentVisitId?: number
  type: VisitType
  method: string
  url: string
  status?: number
  startedAt: number
  finishedAt?: number
  duration?: number
  completed: boolean
  cancelled: boolean
  interrupted: boolean
  prevented?: boolean
  initial?: boolean
  only?: string[]
  except?: string[]
  redirectUrl?: string
  /** Component name from page object */
  component?: string
  /** Feature type strings (e.g. ['partial', 'deferred']) */
  featureTypes: string[]
  /** Whether page.props.errors was non-empty */
  hasErrors: boolean
  diagnostics: Diagnostic[]
}

/** Persisted session data */
export interface SessionSnapshot {
  /** Timestamp when snapshot was saved */
  savedAt: number
  /** Compact request summaries */
  requests: SessionRequestSummary[]
}

/**
 * Documentation site provider for feature links.
 */
export type DocsProvider = 'inertiajs' | 'inertia-rails'

/**
 * Minimal duck type for the app's Inertia router. The devtools cannot import
 * @inertiajs/core at runtime (peer dependency — importing it would bundle a
 * second copy with its own state), so actions only rely on this shape.
 */
export interface InertiaRouterLike {
  visit(url: string, options?: Record<string, unknown>): void
  reload(options?: Record<string, unknown>): void
}

/**
 * Options for initializing the devtools.
 */
export interface DevToolsOptions {
  /** CSP nonce for inline styles in Shadow DOM */
  styleNonce?: string
  /** Override to disable even in dev mode */
  enabled?: boolean
  /** Documentation site for feature links. Default: 'inertiajs' */
  docsProvider?: DocsProvider
  /**
   * The app's own Inertia router — enables devtools actions (replay a visit,
   * reload). Injected automatically by the Vite plugin; manual-import users
   * may pass `router` from @inertiajs/core themselves.
   */
  router?: InertiaRouterLike
}
