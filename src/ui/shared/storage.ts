const KEY_PREFIX = 'inertia-devtools-'

/** Keys stored in sessionStorage (per-tab, survives HMR but not new tabs) */
const SESSION_KEYS = new Set(['panel', 'pip'])

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

// Re-export from core so existing Svelte imports keep working.
export { isNonEmptyRecord } from '../../core/utils'
