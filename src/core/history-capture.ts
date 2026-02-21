import type { InertiaPage } from './protocol'
import type { DevToolsStore } from './store'
import type { StopFunction } from './types'
import { deepEqual } from './diff'

/**
 * Parse state into its `page` field if it looks like an Inertia history entry.
 * Returns 'encrypted' for ArrayBuffer pages, null for non-Inertia state.
 */
function parseInertiaState(state: unknown): InertiaPage | 'encrypted' | null {
  if (state == null || typeof state !== 'object') return null
  const s = state as Record<string, unknown>
  if (!('page' in s)) return null
  if (s.page instanceof ArrayBuffer) return 'encrypted'
  if (typeof s.page !== 'object' || s.page == null) return null
  const p = s.page as Record<string, unknown>
  if (typeof p.component !== 'string' || typeof p.props !== 'object') return null
  return s.page as InertiaPage
}

/**
 * Compare two page objects to detect meaningful changes.
 * Returns true if props, url, flash, or component changed.
 * Uses deep equality for props/flash since object references
 * differ between history state entries even when content is identical
 * (e.g. scroll-save replaceState reuses the same page data).
 */
function hasPageChanged(oldPage: InertiaPage, newPage: InertiaPage): boolean {
  if (oldPage.url !== newPage.url) return true
  if (oldPage.component !== newPage.component) return true
  if (!deepEqual(oldPage.props, newPage.props)) return true
  if (!deepEqual(oldPage.flash, newPage.flash)) return true
  return false
}

/**
 * Monkey-patches `history.pushState` and `history.replaceState` to detect
 * client-side visits that bypass the normal Inertia event lifecycle.
 *
 * Client-side visits (router.push, router.replace, router.replaceProp, etc.)
 * call history.pushState/replaceState directly without firing inertia:before,
 * inertia:start, or inertia:finish events. This capture layer detects those
 * state changes by intercepting the history API.
 *
 * Suppression strategy:
 * `inertia:before` ONLY fires for server visits, never for client visits.
 * We track a counter of pending server visits. When a state change occurs:
 * - If pendingServerVisits > 0 and the page changed → server visit, skip.
 * - If pendingServerVisits === 0 and the page changed → client visit, capture.
 *
 * For unencrypted history: capture synchronously (page readable from state arg).
 * For encrypted history: fall back to deferred check via setTimeout(0).
 *
 * Returns a function to restore the original history methods.
 */
export function startHistoryCapture(store: DevToolsStore): StopFunction {
  if (typeof window === 'undefined') return () => {}

  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)

  // Counter of server visits in progress.
  // inertia:before fires once per server visit (never for client visits).
  // Scroll-save replaceState calls don't affect this — they're filtered
  // by hasPageChanged returning false.
  let pendingServerVisits = 0

  const onBefore = (e: Event) => {
    // Prefetch requests cache data without navigating — they never trigger
    // history.pushState/replaceState, so incrementing would leak the counter.
    const visit = (e as CustomEvent).detail?.visit
    if (visit?.prefetch) return
    pendingServerVisits++
  }
  // v2 fires inertia:cancel as a DOM event; v3 does not.
  // Both versions set cancelled/interrupted on the visit in inertia:finish.
  // Cancelled/interrupted visits don't trigger pushState/replaceState,
  // so we must decrement here to prevent counter leaks.
  const onFinishCancel = (e: Event) => {
    const visit = (e as CustomEvent).detail?.visit
    if (visit && (visit.cancelled || visit.interrupted) && pendingServerVisits > 0) {
      pendingServerVisits--
    }
  }

  document.addEventListener('inertia:before', onBefore)
  document.addEventListener('inertia:finish', onFinishCancel)

  function emitClientVisit(
    method: 'pushState' | 'replaceState',
    newPage: InertiaPage,
    previousPage: InertiaPage,
  ): void {
    try {
      store.captureClientVisit(method === 'pushState' ? 'push' : 'replace', newPage, previousPage)
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.groupCollapsed('[inertia-devtools] Error in history capture')
        console.error(err)
        console.groupEnd()
      }
    }
  }

  /**
   * Deferred check for encrypted history where we can't read the page
   * from the state arg. Falls back to comparing store.currentPage.
   */
  function scheduleEncryptedCheck(method: 'pushState' | 'replaceState', previousPage: InertiaPage): void {
    setTimeout(() => {
      const storePage = store.currentPage
      if (!storePage) return
      if (!hasPageChanged(previousPage, storePage)) return

      emitClientVisit(method, storePage, previousPage)
    }, 0)
  }

  function intercept(method: 'pushState' | 'replaceState', state: unknown): void {
    const parsed = parseInertiaState(state)
    if (!parsed) return

    const previousPage = store.currentPage
    if (!previousPage) return

    if (parsed === 'encrypted') {
      // Encrypted: can't read page synchronously
      if (pendingServerVisits > 0) {
        pendingServerVisits--
        return
      }

      scheduleEncryptedCheck(method, previousPage)
    } else {
      // Server visit's state change — correlator handles via events.
      // Must check BEFORE hasPageChanged: inertia:beforeUpdate already
      // updated lastPage, so store.currentPage === directPage and
      // hasPageChanged would return false, leaking the counter.
      if (pendingServerVisits > 0) {
        pendingServerVisits--
        return
      }

      // Scroll-save replaceState: same page data, no inertia:before fired
      if (!hasPageChanged(previousPage, parsed)) return

      emitClientVisit(method, parsed, previousPage)
    }
  }

  history.pushState = function (state: unknown, title: string, url?: string | URL | null) {
    origPush(state, title, url)
    intercept('pushState', state)
  }

  history.replaceState = function (state: unknown, title: string, url?: string | URL | null) {
    origReplace(state, title, url)
    intercept('replaceState', state)
  }

  return () => {
    history.pushState = origPush
    history.replaceState = origReplace
    document.removeEventListener('inertia:before', onBefore)
    document.removeEventListener('inertia:finish', onFinishCancel)
  }
}
