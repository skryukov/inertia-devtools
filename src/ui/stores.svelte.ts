import type { DevToolsStore } from '../core/store'
import type { InertiaPage } from '../core/protocol'
import type { DevToolsState, RequestRecord } from '../core/types'
import { loadSetting, saveSetting } from './shared/storage'

/**
 * Reactive Svelte 5 wrapper around the vanilla JS DevToolsStore.
 * Uses $state for reactive state that Svelte components can bind to.
 */
export type Theme = 'system' | 'dark' | 'light'

export function createDevToolsContext(store: DevToolsStore) {
  let tick = $state(0)
  // Shallow-clone each record so Svelte's keyed {#each} sees new object
  // references when records are mutated (e.g. finishedAt set on finish).
  let state: DevToolsState = $derived.by(() => {
    void tick
    const raw = store.getState()
    return {
      ...raw,
      requests: raw.requests.map((r) => ({ ...r })),
    }
  })
  let selectedVisitId = $state<number | null>(null)
  let panelOpen = $state(false)
  let activeTab = $state<string>(loadSetting('tab', 'props'))
  let theme = $state<Theme>(loadSetting('theme', 'system') as Theme)
  let requestFilter = $state('')
  let inertiaNotDetectedReady = $state(false)
  let notDetectedTimer: ReturnType<typeof setTimeout> | undefined
  let systemDark = $state(
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true,
  )

  // Listen for system theme changes
  let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null
  let mql: MediaQueryList | null = null
  if (typeof window !== 'undefined') {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mqlHandler = (e) => {
      systemDark = e.matches
    }
    mql.addEventListener('change', mqlHandler)
  }

  // Subscribe to store changes — bump tick to trigger derived recomputation
  const unsubscribe = store.subscribe(() => {
    tick++
  })

  function togglePanel() {
    panelOpen = !panelOpen
    store.setPanelOpen(panelOpen)

    saveSetting('panel', panelOpen ? 'open' : 'closed')
  }

  function selectRequest(visitId: number) {
    if (selectedVisitId === visitId) {
      selectedVisitId = null
    } else {
      selectedVisitId = visitId
    }
  }

  function deselectRequest() {
    selectedVisitId = null
  }

  function selectNextRequest() {
    const reqs = state.requests
    if (reqs.length === 0) return
    if (selectedVisitId === null) {
      selectedVisitId = reqs[0].visitId
      return
    }
    const idx = reqs.findIndex((r) => r.visitId === selectedVisitId)
    if (idx < reqs.length - 1) {
      selectedVisitId = reqs[idx + 1].visitId
    }
  }

  function selectPrevRequest() {
    const reqs = state.requests
    if (reqs.length === 0) return
    if (selectedVisitId === null) {
      selectedVisitId = reqs[reqs.length - 1].visitId
      return
    }
    const idx = reqs.findIndex((r) => r.visitId === selectedVisitId)
    if (idx > 0) {
      selectedVisitId = reqs[idx - 1].visitId
    }
  }

  // Migrate stale tab names to 'props'
  if (activeTab === 'page' || activeTab === 'raw') activeTab = 'props'

  function setActiveTab(tab: string) {
    activeTab = tab
    saveSetting('tab', tab)
  }

  function setRequestFilter(value: string) {
    requestFilter = value
  }

  function clearAll() {
    store.clear()
    selectedVisitId = null
  }

  function cycleTheme() {
    const order: Theme[] = ['system', 'dark', 'light']
    theme = order[(order.indexOf(theme) + 1) % order.length]
    saveSetting('theme', theme)
  }

  const resolvedTheme = $derived<'dark' | 'light'>(theme === 'system' ? (systemDark ? 'dark' : 'light') : theme)

  const selectedRequest = $derived.by((): RequestRecord | null => {
    if (selectedVisitId === null) return null
    return state.requests.find((r) => r.visitId === selectedVisitId) ?? null
  })

  const currentPage = $derived(state.currentPage)

  const latestRequest = $derived.by((): RequestRecord | null => {
    if (state.requests.length === 0) return null
    return state.requests[state.requests.length - 1]
  })

  /** Page-level features derived from the current page (excludes request-specific features). */
  const currentPageFeatures = $derived(currentPage ? store.getPageFeatures(currentPage) : [])

  /** previousPage for live view diff — always the most recent request's previousPage.
   *  Shows what the LAST change was, regardless of type (full, deferred, partial, client). */
  const currentPagePrevious = $derived.by((): InertiaPage | undefined => {
    for (let i = state.requests.length - 1; i >= 0; i--) {
      if (state.requests[i].previousPage) {
        return state.requests[i].previousPage
      }
    }
    return undefined
  })

  // Start a 3-second timer to show "Inertia not detected" message.
  // Auto-dismissed once any Inertia event fires (requests appear).
  notDetectedTimer = setTimeout(() => {
    inertiaNotDetectedReady = true
  }, 3000)

  const showInertiaNotDetected = $derived(
    inertiaNotDetectedReady && state.requests.length === 0 && state.currentPage === null,
  )

  // Restore panel state from localStorage
  if (loadSetting('panel', '') === 'open') {
    panelOpen = true
    store.setPanelOpen(true)
  }

  function destroy() {
    unsubscribe()
    clearTimeout(notDetectedTimer)
    if (mql && mqlHandler) {
      mql.removeEventListener('change', mqlHandler)
    }
  }

  return {
    get state() {
      return state
    },
    get currentPage() {
      return currentPage
    },
    get panelOpen() {
      return panelOpen
    },
    get activeTab() {
      return activeTab
    },
    get selectedVisitId() {
      return selectedVisitId
    },
    get selectedRequest() {
      return selectedRequest
    },
    get latestRequest() {
      return latestRequest
    },
    get currentPageFeatures() {
      return currentPageFeatures
    },
    get currentPagePrevious() {
      return currentPagePrevious
    },
    get requestFilter() {
      return requestFilter
    },
    get theme() {
      return theme
    },
    get previousSessionRequests() {
      return store.previousSessionRequests
    },
    get showInertiaNotDetected() {
      return showInertiaNotDetected
    },
    get docsProvider() {
      return store.docsProvider
    },
    get resolvedTheme() {
      return resolvedTheme
    },
    togglePanel,
    selectRequest,
    selectNextRequest,
    selectPrevRequest,
    deselectRequest,
    setActiveTab,
    clearAll,
    setRequestFilter,
    cycleTheme,
    destroy,
    store,
  }
}

export type DevToolsContext = ReturnType<typeof createDevToolsContext>
