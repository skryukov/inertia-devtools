/**
 * Estimate JSON byte size of a value.
 * Uses a fast heuristic: JSON.stringify length (characters ≈ bytes for ASCII-heavy data).
 */
export function jsonByteSize(val: unknown): number {
  try {
    return JSON.stringify(val)?.length ?? 0
  } catch {
    return 0
  }
}

/** Format byte count as human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format a scalar value for inline display in tree views.
 */
export function formatScalar(val: unknown, maxLen = 30): string {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (typeof val === 'string') return `"${val.length > maxLen ? val.slice(0, maxLen) + '...' : val}"`
  if (typeof val === 'boolean' || typeof val === 'number') return String(val)
  if (Array.isArray(val)) return `Array(${val.length})`
  if (typeof val === 'object') return `{...}`
  return String(val)
}

/**
 * Format a value for inline preview in tree nodes.
 * Shows a compact representation including nested keys for objects.
 */
export function inlineValue(val: unknown, maxLen = 40): string {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (typeof val === 'string') return `"${val.length > maxLen ? val.slice(0, maxLen) + '\u2026' : val}"`
  if (typeof val === 'boolean' || typeof val === 'number') return String(val)
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]'
    return `Array(${val.length})`
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val)
    if (keys.length === 0) return '{}'
    const pairs = keys.slice(0, 3).map((k) => `${k}: ${formatScalar((val as Record<string, unknown>)[k])}`)
    return `{${pairs.join(', ')}${keys.length > 3 ? ', \u2026' : ''}}`
  }
  return String(val)
}
