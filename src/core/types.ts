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
}

/**
 * Visit type classification.
 */
export type VisitType = 'full' | 'partial' | 'prefetch' | 'deferred' | 'redirect' | 'client'

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
  redirectUrl?: string
  visitOptions?: Record<string, unknown>
  diagnostics: Diagnostic[]
  network?: NetworkTiming
}

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
 * Options for initializing the devtools.
 */
export interface DevToolsOptions {
  /** CSP nonce for inline styles in Shadow DOM */
  styleNonce?: string
  /** Override to disable even in dev mode */
  enabled?: boolean
  /** Documentation site for feature links. Default: 'inertiajs' */
  docsProvider?: DocsProvider
}
