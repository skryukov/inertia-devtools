const KEY_PREFIX = 'inertia-devtools-'

/** Keys stored in sessionStorage (per-tab, survives HMR but not new tabs) */
const SESSION_KEYS = new Set(['panel', 'pip'])

/**
 * Every access is guarded, including the property read itself: merely touching
 * `window.localStorage` throws SecurityError when site data is blocked (Safari
 * "Block All Cookies", a partitioned third-party iframe, Firefox with
 * `dom.storage.enabled=false`), and `setItem` throws QuotaExceededError in
 * Safari private mode. Both used to escape — the read during store setup killed
 * the whole mount ("Failed to load UI"), and the write threw out of a click
 * handler into the host app's error reporting. A devtool cannot be the reason
 * an app looks broken.
 */
function storageFor(key: string): Storage | undefined {
  try {
    if (typeof window === 'undefined') return undefined
    return SESSION_KEYS.has(key) ? window.sessionStorage : window.localStorage
  } catch {
    return undefined
  }
}

export function loadSetting(key: string, fallback: string): string {
  try {
    return storageFor(key)?.getItem(KEY_PREFIX + key) ?? fallback
  } catch {
    return fallback
  }
}

export function saveSetting(key: string, value: string): void {
  try {
    storageFor(key)?.setItem(KEY_PREFIX + key, value)
  } catch {
    /* quota exceeded or blocked — the setting just does not persist */
  }
}

// Re-export from core so existing Svelte imports keep working.
export { isNonEmptyRecord } from '../../core/utils'
