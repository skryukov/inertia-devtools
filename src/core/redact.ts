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
  if (!isWalkable(value)) return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactDeep(entry, depth + 1)
  }
  return out
}

/**
 * Redact a value on its way OUT of the tool — exports, clipboard, markdown.
 *
 * Page props are deliberately NOT masked at capture: you cannot debug props you
 * cannot see, and the panel is the developer's own screen. The export is a
 * different audience — "Copy for AI" exists to be pasted into a GitHub issue or
 * a chat — and the Rails and Laravel adapters put a live `csrf_token` in props
 * on *every* page, alongside whatever else the app shares (session tokens, the
 * signed-in user's PII).
 *
 * Unlike `redactDeep` this takes no depth cap. That one runs on every captured
 * event and is bounded on purpose, but bailing out past a depth limit returns
 * the raw subtree — fail-open, which is exactly wrong at an export boundary.
 * Here the walk is user-initiated and rare, so it goes all the way down and
 * uses a seen-set for cycles instead.
 */
export function redactExport<T>(value: T): T {
  return walkForExport(value, new WeakSet()) as T
}

function walkForExport(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) return value.map((entry) => walkForExport(entry, seen))
  if (!isWalkable(value)) return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : walkForExport(entry, seen)
  }
  return out
}

/**
 * Types whose innards we deliberately do not walk: binary payloads and host
 * objects carry no inspectable keys, and `JSON.stringify` does not expand them
 * either, so skipping them hides nothing.
 */
function isOpaqueObject(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Error ||
    value instanceof Map ||
    value instanceof Set ||
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof FormData !== 'undefined' && value instanceof FormData) ||
    (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value))
  )
}

/**
 * Anything with own enumerable keys that `JSON.stringify` would serialize.
 *
 * This deliberately accepts CLASS INSTANCES, not just object literals. Checking
 * for `Object.prototype` skipped them — and `JSON.stringify` ignores prototypes
 * and serializes own properties regardless, so a form model or a Precognition
 * object walked straight past the redactor and into the export with its
 * `password` field intact.
 */
function isWalkable(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  return !isOpaqueObject(value)
}
