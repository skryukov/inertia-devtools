import type { RequestRecord, Diagnostic } from './types'
import { normalizeUrl } from './url'

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
  detectErrorsFiltered,
  detectDeferredFailed,
  detectHistoryReplace,
]

function detectVersionMismatch(req: RequestRecord): Diagnostic | null {
  if (req.type === 'redirect' && req.status === 409) {
    return { id: 'version-mismatch', severity: 'warning', message: 'Version mismatch — full page reload' }
  }
  return null
}

function detectCancelledVisit(req: RequestRecord): Diagnostic | null {
  if (req.interrupted) {
    return { id: 'visit-interrupted', severity: 'info', message: 'Interrupted by a newer visit' }
  }
  if (req.cancelled) {
    return { id: 'visit-cancelled', severity: 'info', message: 'Visit was cancelled' }
  }
  return null
}

function detectPartialPropMissing(req: RequestRecord): Diagnostic | null {
  if (req.only?.length && req.page?.props) {
    const keys = Object.keys(req.page.props)
    const missing = req.only.filter((k) => !keys.includes(k))
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

function detectErrorsFiltered(req: RequestRecord): Diagnostic | null {
  if (req.only && req.only.length > 0 && !req.only.includes('errors')) {
    const hasError = req.status === 422 || req.events.some((e) => e.name === 'inertia:error')
    if (hasError) {
      return {
        id: 'errors-filtered',
        severity: 'warning',
        message: "Validation errors may be filtered: 'only' option doesn't include 'errors'",
      }
    }
  }
  return null
}

function detectDeferredFailed(req: RequestRecord): Diagnostic | null {
  if (req.type === 'deferred' && req.error) {
    return { id: 'deferred-failed', severity: 'error', message: 'Deferred props failed to load' }
  }
  return null
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
