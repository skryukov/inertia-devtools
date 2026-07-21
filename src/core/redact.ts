/**
 * Redaction of credentials before they enter the store.
 *
 * Visit options carry the request body verbatim (`data`) and any caller-supplied
 * headers, and wire capture carries the real request/response headers. All of it
 * is rendered in the panel AND serialized by the markdown/JSON export — a
 * feature whose whole purpose is pasting into an issue or a chat. A login POST
 * would otherwise put the password, CSRF token, and bearer token on the
 * clipboard, so masking happens at capture time rather than at export: there is
 * no second path to keep in sync, and screenshots stay safe too.
 *
 * Keys are matched as substrings, deliberately spelling out `authorization`
 * rather than `auth` so an ordinary `author` prop is not mangled. Structure is
 * always preserved — only the value is replaced, so the shape stays debuggable.
 */

export const REDACTED = '[REDACTED]'

const SENSITIVE_KEY =
  /password|passwd|pwd|secret|token|authorization|cookie|csrf|xsrf|api[-_]?key|access[-_]?key|private[-_]?key|credential|session[-_]?id/i

/** Recursion limit — deep prop trees are the norm, cycles are not. */
const MAX_DEPTH = 8

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/**
 * Mask sensitive entries in a flat header map. Header values are strings by
 * contract, but Inertia hands through whatever the caller set (booleans appear
 * for `X-Inertia`), so non-strings are preserved as-is when not sensitive.
 */
export function redactHeaders<T>(headers: Record<string, T>): Record<string, T | string> {
  const out: Record<string, T | string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isSensitiveKey(key) ? REDACTED : value
  }
  return out
}

/**
 * Mask sensitive entries anywhere in a value tree. Only plain objects and
 * arrays are walked; File/Blob/FormData and other host objects are passed
 * through untouched (they carry no keys we can inspect, and cloning them here
 * would be wasteful).
 */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return value
  if (Array.isArray(value)) {
    return value.map((entry) => redactDeep(entry, depth + 1))
  }
  if (!isPlainObject(value)) return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactDeep(entry, depth + 1)
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
