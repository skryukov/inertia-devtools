import type { RequestRecord, SessionSnapshot, SessionRequestSummary } from './types'
import { isNonEmptyRecord } from '../ui/shared/storage'

const SESSION_KEY = 'inertia-devtools-session'
const MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

/** Convert a full RequestRecord to a compact summary */
export function summarizeRequest(req: RequestRecord): SessionRequestSummary {
  return {
    visitId: req.visitId,
    parentVisitId: req.parentVisitId,
    type: req.type,
    method: req.method,
    url: req.url,
    status: req.status,
    startedAt: req.startedAt,
    finishedAt: req.finishedAt,
    duration: req.duration,
    completed: req.completed,
    cancelled: req.cancelled,
    interrupted: req.interrupted,
    only: req.only,
    except: req.except,
    redirectUrl: req.redirectUrl,
    component: req.page?.component,
    featureTypes: req.features.map((f) => f.type),
    hasErrors: isNonEmptyRecord(req.page?.props?.errors),
    diagnostics: req.diagnostics,
  }
}

/** Save current requests to sessionStorage */
export function saveSession(requests: RequestRecord[]): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    const snapshot: SessionSnapshot = {
      savedAt: Date.now(),
      requests: requests.map(summarizeRequest),
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot))
  } catch {
    /* quota exceeded or blocked — silently fail */
  }
}

/** Load previous session from sessionStorage, returns null if expired/missing */
export function loadSession(): SessionSnapshot | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const snapshot: SessionSnapshot = JSON.parse(raw)
    // Expire after 5 minutes
    if (Date.now() - snapshot.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return snapshot
  } catch {
    return null
  }
}

/** Clear persisted session */
export function clearSession(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(SESSION_KEY)
}
