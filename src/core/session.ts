import type { RequestRecord, SessionSnapshot, SessionRequestSummary } from './types'
import { isNonEmptyRecord } from './utils'
import { redactUrl } from './redact'

const SESSION_KEY = 'inertia-devtools-session'
const MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

/** Convert a full RequestRecord to a compact summary */
export function summarizeRequest(req: RequestRecord): SessionRequestSummary {
  return {
    visitId: req.visitId,
    parentVisitId: req.parentVisitId,
    type: req.type,
    method: req.method,
    // Redacted like every other outbound URL: this lands in sessionStorage for
    // 5 minutes, readable by any same-origin script, and a password-reset visit
    // carries its `?token=` right here. Every other export path masks these;
    // the session summary was the one that copied them raw.
    url: redactUrl(req.url),
    status: req.status,
    startedAt: req.startedAt,
    finishedAt: req.finishedAt,
    duration: req.duration,
    completed: req.completed,
    cancelled: req.cancelled,
    interrupted: req.interrupted,
    failed: req.failed,
    prevented: req.prevented,
    initial: req.initial,
    only: req.only,
    except: req.except,
    redirectUrl: req.redirectUrl ? redactUrl(req.redirectUrl) : req.redirectUrl,
    component: req.page?.component,
    featureTypes: req.features.map((f) => f.type),
    hasErrors: isNonEmptyRecord(req.page?.props?.errors),
    diagnostics: req.diagnostics,
  }
}

/**
 * `typeof sessionStorage === 'undefined'` looks like a guard and is not one.
 * The global is an accessor, so `typeof` invokes it — and it throws
 * `SecurityError` when site data is blocked (Safari "Block All Cookies", a
 * partitioned third-party iframe, Chrome with cookies blocked for the origin).
 * The check therefore threw in exactly the situation it was written for, and it
 * sat *outside* the try. `loadSession()` runs from the `DevToolsStore`
 * constructor, so that throw escaped into the host app's entrypoint at module
 * eval time — the devtool taking the app down with it.
 */
function sessionStore(): Storage | undefined {
  try {
    if (typeof window === 'undefined') return undefined
    return window.sessionStorage
  } catch {
    return undefined
  }
}

/** Save current requests to sessionStorage */
export function saveSession(requests: RequestRecord[]): void {
  try {
    const storage = sessionStore()
    if (!storage) return
    const snapshot: SessionSnapshot = {
      savedAt: Date.now(),
      requests: requests.map(summarizeRequest),
    }
    storage.setItem(SESSION_KEY, JSON.stringify(snapshot))
  } catch {
    /* quota exceeded or blocked — silently fail */
  }
}

/** Load previous session from sessionStorage, returns null if expired/missing */
export function loadSession(): SessionSnapshot | null {
  try {
    const storage = sessionStore()
    if (!storage) return null
    const raw = storage.getItem(SESSION_KEY)
    if (!raw) return null
    const snapshot: SessionSnapshot = JSON.parse(raw)
    // Expire after 5 minutes
    if (Date.now() - snapshot.savedAt > MAX_AGE_MS) {
      storage.removeItem(SESSION_KEY)
      return null
    }
    return snapshot
  } catch {
    return null
  }
}

/** Clear persisted session */
export function clearSession(): void {
  try {
    sessionStore()?.removeItem(SESSION_KEY)
  } catch {
    /* blocked — nothing to clear */
  }
}
