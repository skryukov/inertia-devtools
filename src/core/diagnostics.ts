import type { RequestRecord, Diagnostic } from './types'
import type { InertiaPage } from './protocol'
import { normalizeUrl } from './url'
import { deepEqual } from './diff'

/** Run all diagnostic rules against a request record. */
export function computeDiagnostics(req: RequestRecord): Diagnostic[] {
  const diags: Diagnostic[] = []
  for (const rule of rules) {
    const d = rule(req)
    if (d) diags.push(d)
  }
  return diags
}

type DiagnosticRule = (req: RequestRecord) => Diagnostic | null

const rules: DiagnosticRule[] = [
  detectVersionMismatch,
  detectCancelledVisit,
  detectPartialPropMissing,
  detectPartialIgnored,
  detectRescuedProps,
  detectStaleErrors,
  detectDiscardedResponse,
  detectDeferredFailed,
  detectRequestFailed,
  detectHistoryReplace,
]

/** Case-insensitive header lookup — capture preserves whatever casing the wire used. */
function responseHeader(req: RequestRecord, name: string): string | undefined {
  const headers = req.wire?.response?.headers
  if (!headers) return undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return typeof value === 'string' ? value : undefined
  }
  return undefined
}

function detectVersionMismatch(req: RequestRecord): Diagnostic | null {
  // Inertia >= 3.6 fires inertia:location with the redirect reason.
  const location = req.events.find((e) => e.name === 'inertia:location')
  if (location) {
    if (location.detail.versionChange === true) {
      return { id: 'version-mismatch', severity: 'warning', message: 'Version mismatch — full page reload' }
    }
    return { id: 'server-redirect', severity: 'info', message: 'Server redirect via inertia_location' }
  }

  if (req.status !== 409) return null

  // A 409 is NOT automatically a version mismatch. The protocol overloads it
  // for three different things, and the response header says which — telling a
  // developer their asset version is stale when they actually called
  // `Inertia::location()` sends them to debug a bug they do not have.
  //
  // `x-inertia-redirect` is the worst of the three to get wrong: Inertia
  // follows it with `router.visit` (core dist:2485-2489), so no full page
  // reload happens at all and the old message asserted one did.
  if (responseHeader(req, 'x-inertia-redirect')) {
    return {
      id: 'server-redirect',
      severity: 'info',
      message: 'Server redirect — Inertia followed it client-side, no page reload',
    }
  }
  if (responseHeader(req, 'x-inertia-location')) {
    return { id: 'server-redirect', severity: 'info', message: 'Server redirect via inertia_location' }
  }

  // Headers were captured and neither redirect header is present: by the
  // protocol that leaves version mismatch, so assert it.
  if (req.wire?.response?.headers) {
    return { id: 'version-mismatch', severity: 'warning', message: 'Version mismatch — full page reload' }
  }

  // No headers at all — the 409 is known only from Resource Timing (interceptors
  // unavailable, or Inertia 3.4/3.5 firing no event for location 409s). Report
  // the reload without guessing which of the three causes it was.
  return { id: 'forced-reload', severity: 'warning', message: '409 Conflict — server forced a full page reload' }
}

function detectCancelledVisit(req: RequestRecord): Diagnostic | null {
  if (req.prevented) {
    return { id: 'visit-prevented', severity: 'info', message: 'Visit prevented by an inertia:before listener' }
  }
  if (req.interrupted) {
    return { id: 'visit-interrupted', severity: 'info', message: 'Interrupted by a newer visit' }
  }
  if (req.cancelled) {
    return { id: 'visit-cancelled', severity: 'info', message: 'Visit was cancelled' }
  }
  return null
}

/**
 * The client matches partial `only` entries with isPathOrSubPath: a dotted
 * entry like 'users.data' requests the nested prop, and the adapter responds
 * with the nested structure. Walk the path segment by segment — a missing
 * intermediate segment counts as missing.
 */
function hasPropAtPath(props: Record<string, unknown>, path: string): boolean {
  let current: unknown = props
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(segment in current)) {
      return false
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return true
}

/**
 * A failed, cancelled or discarded request says nothing about the server's prop
 * shape. Keyed off `failed`, not `error` — `error` also holds validation errors,
 * and those responses merged normally (guarding on them would silence the very
 * rules that inspect merged errors).
 *
 * `cancelled`/`interrupted` are in here because the correlator back-fills
 * `record.page` from `lastPage` for deferred records that never got one. That
 * is right for display — the panel should show what was on screen — but it left
 * the prop rules diffing the PRE-visit page against an `only:` list, so opening
 * a page with `Inertia::defer(:stats)` and clicking away within 200ms accused
 * the server of dropping a prop it was never given time to send.
 */
function propRulesApply(req: RequestRecord): boolean {
  if (req.failed || (req.status ?? 0) >= 400) return false
  if (req.cancelled || req.interrupted || req.prevented) return false
  return !isDiscardedResponse(req)
}

/**
 * The server honors `only`/`except` only when the visit's component matches
 * the page it was issued from (that is what X-Inertia-Partial-Component is
 * checked against). A partial that lands somewhere else — an auth redirect, a
 * route returning a different page — gets a plain full response instead, so
 * the requested props were never expected in it.
 */
function partialWasApplied(req: RequestRecord): boolean {
  const from = req.previousPage?.component
  const to = req.page?.component
  // Unknown either side: assume applied rather than silently skipping a rule.
  if (!from || !to) return true
  return from === to
}

function detectPartialIgnored(req: RequestRecord): Diagnostic | null {
  const isPartial = Boolean(req.only?.length || req.except?.length)
  if (!isPartial || !propRulesApply(req) || partialWasApplied(req)) return null

  return {
    id: 'partial-ignored',
    severity: 'info',
    message: `Partial reload ignored — the visit landed on '${req.page?.component}' instead of '${req.previousPage?.component}', so the server returned a full page`,
  }
}

function detectPartialPropMissing(req: RequestRecord): Diagnostic | null {
  // A discarded response never merged, so req.page is the superseding page —
  // judging the requested props against it would be a false alarm; failed
  // requests never delivered props at all. A partial the server ignored is
  // reported by detectPartialIgnored with the actual reason.
  if (!partialWasApplied(req)) return null
  if (req.only?.length && req.page?.props && propRulesApply(req)) {
    const props = req.page.props
    // A rescued prop is absent on purpose — detectRescuedProps reports it with
    // the real cause instead of blaming the partial reload.
    const rescued = new Set(req.page.rescuedProps ?? [])
    const missing = req.only.filter((path) => !hasPropAtPath(props, path) && !rescued.has(path))
    if (missing.length) {
      return {
        id: 'partial-prop-missing',
        severity: 'warning',
        message: `Partial reload: '${missing.join("', '")}' requested but missing from response`,
      }
    }
  }
  return null
}

/**
 * Partial responses merge as `{...oldProps, ...newProps}`, so errors set by a
 * previous visit survive any partial reload whose response omits them (and
 * preserveErrors requests keep them on purpose). Surface errors that are
 * byte-identical to the pre-visit ones — they may well be stale.
 */
function detectStaleErrors(req: RequestRecord): Diagnostic | null {
  const isPartial = Boolean(req.only?.length || req.except?.length)
  if (!isPartial) return null
  // Failed and discarded responses never merged — their req.page says nothing
  // about this visit. Nor did an ignored partial: that response replaced the
  // page wholesale, so its errors came from the server, not a merge.
  if (!propRulesApply(req) || !partialWasApplied(req)) return null

  const errors = req.page?.props?.errors
  if (!isNonEmptyObject(errors)) return null

  const previousErrors = req.previousPage?.props?.errors
  if (!previousErrors || !deepEqual(errors, previousErrors)) return null

  return {
    id: 'stale-errors',
    severity: 'info',
    message:
      'Validation errors carried over from a previous visit — the partial merge preserves them; they may be stale',
  }
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

/**
 * Async responses can be discarded: shouldSetPage() returns false when a later
 * navigation moved the app off the originating page mid-flight. setPage() then
 * does nothing — no beforeUpdate, no navigate — but inertia:success still
 * fires with this visit's id carrying the *current* page (page.get()).
 * Detect that shape: an async visit whose success page shows the app somewhere
 * other than where the visit started, with no page-update events attached.
 */
function isDiscardedResponse(req: RequestRecord): boolean {
  if (req.visitOptions?.async !== true) return false
  if (req.events.some((e) => e.name === 'inertia:beforeUpdate' || e.name === 'inertia:navigate')) return false

  const success = req.events.find((e) => e.name === 'inertia:success')
  const successPage = success?.detail.page as InertiaPage | undefined
  if (!successPage) return false

  // If the app never moved off the visit's origin, the response was applied
  // (same-URL replace visits legitimately lack a navigate) — not discarded.
  const prev = req.previousPage
  if (!prev) return false
  return successPage.component !== prev.component || normalizeUrl(successPage.url) !== normalizeUrl(prev.url)
}

function detectDiscardedResponse(req: RequestRecord): Diagnostic | null {
  if (!isDiscardedResponse(req)) return null
  return {
    id: 'response-discarded',
    severity: 'info',
    message: 'Response discarded — a later navigation superseded this visit',
  }
}

/**
 * A prop resolver that throws server-side can be rescued
 * (`Inertia::defer(..., rescue: true)`), so the response omits the prop and
 * lists it in `page.rescuedProps` — a 200 that silently lost data. Report only
 * props THIS visit newly rescued; the list persists across visits until a
 * partial reload re-requests them, which would otherwise re-warn forever.
 *
 * NOT 3.6+, as this said until now: `rescuedProps: string[]` is a REQUIRED
 * field of Page in @inertiajs/core 3.4.0 (types.d.ts:147), which is the floor
 * the peer range declares. Labelling it 3.6 told every 3.4/3.5 user that a
 * feature they already have is unavailable.
 */
function detectRescuedProps(req: RequestRecord): Diagnostic | null {
  if (!propRulesApply(req)) return null
  const rescued = req.page?.rescuedProps
  if (!Array.isArray(rescued) || rescued.length === 0) return null

  const previous = new Set(req.previousPage?.rescuedProps ?? [])
  const fresh = rescued.filter((prop) => typeof prop === 'string' && !previous.has(prop))
  if (fresh.length === 0) return null

  return {
    id: 'prop-rescued',
    severity: 'warning',
    message: `'${fresh.join("', '")}' failed to resolve on the server and was rescued — the page rendered without it`,
  }
}

function detectDeferredFailed(req: RequestRecord): Diagnostic | null {
  // `failed`, not `error`: a deferred group whose response merely carried
  // validation errors loaded fine.
  if (req.type === 'deferred' && req.failed) {
    return { id: 'deferred-failed', severity: 'error', message: 'Deferred props failed to load' }
  }
  return null
}

/**
 * Any other failed visit — a network error, or an HTTP error with no Inertia
 * body. `deferred-failed` covers the deferred case with a more specific
 * message; without this rule every non-deferred failure surfaced as an empty
 * diagnostics list, so the row that most needs an explanation had none.
 */
function detectRequestFailed(req: RequestRecord): Diagnostic | null {
  if (!req.failed || req.type === 'deferred') return null
  const message =
    req.status && req.status >= 400
      ? `Request failed — HTTP ${req.status}`
      : 'Request failed — no response reached the client (network error or blocked request)'
  return { id: 'request-failed', severity: 'error', message }
}

function detectHistoryReplace(req: RequestRecord): Diagnostic | null {
  if (req.type === 'client' && req.method === 'REPLACE') {
    return { id: 'history-replace', severity: 'info', message: 'History replaced (same URL)' }
  }
  if (req.visitOptions?.replace === true) {
    // Check if same URL as previous page
    const prevUrl = req.previousPage?.url
    if (prevUrl && normalizeUrl(prevUrl) === normalizeUrl(req.url)) {
      return { id: 'history-replace-same-url', severity: 'info', message: 'History replaced (same URL)' }
    }
    return { id: 'history-replace', severity: 'info', message: 'History replace mode' }
  }
  return null
}
