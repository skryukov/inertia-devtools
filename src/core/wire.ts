/**
 * Shared helpers for visit identity and wire-level data.
 * Used by both the correlator (event payloads) and the interceptor capture.
 */

/** Extract Inertia's visit UUID from a visit-shaped object. */
export function visitUuid(visit: { id?: unknown } | undefined): string | undefined {
  const id = visit?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * Approximate byte size of a response body. Strings are measured as UTF-8
 * without allocating a copy (this runs inside the host app's response chain);
 * already-parsed objects (prefetched event payloads) fall back to JSON length.
 */
export function wireBodySize(data: unknown): number | undefined {
  if (typeof data === 'string') return utf8Length(data)
  if (data != null && typeof data === 'object') {
    try {
      return JSON.stringify(data)?.length
    } catch {
      return undefined
    }
  }
  return undefined
}

function utf8Length(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // surrogate pair encodes as 4 bytes; skip the low surrogate
      bytes += 4
      i++
    } else {
      bytes += 3
    }
  }
  return bytes
}
