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

/**
 * Substring signals for a sensitive key, case-insensitive. `authorization` is
 * spelled out rather than `auth` so an ordinary `author` prop survives; `otp`,
 * `mfa`, `totp` are anchored with `\b…` prefixes so they still catch `otpCode`
 * / `mfaSecret` without matching a word that merely contains them.
 */
const SENSITIVE_KEY =
  /password|passwd|pwd|secret|token|authorization|cookie|csrf|xsrf|api[-_]?key|access[-_]?key|private[-_]?key|credential|session[-_]?(id|key|token|secret)|\bjwt\b|bearer|signature|\botp|\bmfa|\btotp|2fa|recovery|\bpin\b|\bssn\b|\bcvv\b|\bcvc\b|card[-_]?number|\biban\b|[-_]key$/i

/**
 * Case-SENSITIVE camelCase secret suffixes: `stripeKey`, `signingKey`,
 * `sessionToken`. Kept separate because under the `/i` flag `[a-z]Key$` also
 * matches the tail of `monkey`, `donkey`, `whiskey` — the classic
 * over-redaction. Requiring a lowercase letter before an uppercase `Key`
 * distinguishes a camelCase boundary from an ordinary word.
 */
const SENSITIVE_KEY_CAMEL = /[a-z](Key|Sig|Token|Secret|Pwd|Password)$/

/** Recursion limit — deep prop trees are the norm, cycles are not. */
const MAX_DEPTH = 8

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_KEY_CAMEL.test(key)
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

/**
 * Keys whose string values are URLs, so their query strings get masked too.
 *
 * NOT anchored `^…$`: an app calls its reset link `resetUrl`, its magic link
 * `callbackUrl`, its signed download `signedUrl` — the exact motivating cases —
 * and the exact-match version caught only a bare `url`. `(^|[a-z])` accepts a
 * camelCase/prefixed suffix while still rejecting an unrelated word; the `i`
 * flag catches `Url`/`URL`.
 */
const URL_KEY = /(^|[a-z])(url|uri|href|location)$/i

/**
 * Mask credentials carried IN a URL — query string, fragment, and basic-auth
 * userinfo — keeping structure visible.
 *
 * Password-reset links, magic-link callbacks and signed S3 URLs put the
 * credential in the query; the OAuth implicit flow puts the access token in the
 * fragment (`#access_token=`); and `https://user:pass@host` puts a password in
 * the authority. A URL is the one field every export path emits — `record.url`,
 * `wire.request.url`, `redirectUrl` — so all three had to be covered. Seeing
 * that a `?token=` was present is the debuggable part; its value is not.
 *
 * Relative URLs are the norm here, so parsing goes through a dummy base and the
 * origin is stripped back off when the input had none. Anything unparseable, or
 * with nothing to mask, is returned BYTE-IDENTICAL — round-tripping through URL
 * reorders and re-encodes, so an untouched URL must never go through it.
 */
export function redactUrl(url: string): string {
  // Nothing that could carry a secret in any of the three positions.
  if (!url.includes('?') && !url.includes('#') && !url.includes('@')) return url
  try {
    const base = 'http://redact.invalid'
    const parsed = new URL(url, base)
    let touched = false

    // Basic-auth userinfo: https://user:pa55w0rd@host
    if (parsed.password) {
      parsed.password = REDACTED
      touched = true
    }

    // Query string. Collected before mutating: set() rewrites the same
    // collection keys() is walking.
    const queryKeys = [...parsed.searchParams.keys()].filter(isSensitiveKey)
    for (const key of queryKeys) {
      parsed.searchParams.set(key, REDACTED)
      touched = true
    }

    // Fragment: #access_token=… (OAuth implicit flow) is itself a query string.
    if (parsed.hash.length > 1) {
      const frag = new URLSearchParams(parsed.hash.slice(1))
      const fragKeys = [...frag.keys()].filter(isSensitiveKey)
      if (fragKeys.length > 0) {
        for (const key of fragKeys) frag.set(key, REDACTED)
        parsed.hash = `#${frag.toString()}`
        touched = true
      }
    }

    if (!touched) return url
    const hadOrigin = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
    const rebuilt = parsed.toString()
    return hadOrigin ? rebuilt : rebuilt.slice(parsed.origin.length)
  } catch {
    return url
  }
}

/**
 * `seen` tracks the current PATH, not every object ever visited — so it is
 * cleaned up on the way back out.
 *
 * Leaving entries in permanently turned the cycle guard into a
 * shared-reference guard: `{ author: user, editor: user }` exported the second
 * one as `[Circular]` even though nothing is cyclic. Aliasing like that is
 * ordinary in Inertia props (the same user object shared across props, a lookup
 * table referenced from several rows), so the export silently lost real data
 * and blamed a cycle that was not there.
 */
function walkForExport(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  if (!Array.isArray(value) && !isWalkable(value)) return value

  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((entry) => walkForExport(entry, seen))

    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED
      } else if (URL_KEY.test(key) && typeof entry === 'string') {
        out[key] = redactUrl(entry)
      } else {
        out[key] = walkForExport(entry, seen)
      }
    }
    return out
  } finally {
    seen.delete(value)
  }
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
