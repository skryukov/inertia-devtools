const KEY_PREFIX = 'inertia-devtools-'

/** Keys stored in sessionStorage (per-tab, survives HMR but not new tabs) */
const SESSION_KEYS = new Set(['panel'])

function storageFor(key: string): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  return SESSION_KEYS.has(key) ? sessionStorage : localStorage
}

export function loadSetting(key: string, fallback: string): string {
  const storage = storageFor(key)
  if (!storage) return fallback
  return storage.getItem(KEY_PREFIX + key) ?? fallback
}

export function saveSetting(key: string, value: string): void {
  const storage = storageFor(key)
  if (!storage) return
  storage.setItem(KEY_PREFIX + key, value)
}

/**
 * Type guard: value is a non-null, non-array object with at least one key.
 */
export function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}
