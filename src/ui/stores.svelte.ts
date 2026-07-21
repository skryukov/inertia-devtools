import type { StoreClient } from '../core/client'
import type { InertiaPage } from '../core/protocol'
import type { DevToolsState, RequestRecord, SessionRequestSummary } from '../core/types'
import { extractPageFeatures } from '../core/features'
import { loadSetting, saveSetting } from './shared/storage'
import { openPipWindow, type PipHandle } from './pip'

/**
 * Reactive Svelte 5 wrapper around a StoreClient.
 * Uses $state for reactive state that Svelte components can bind to.
 */
export type Theme = 'system' | 'dark' | 'light'

export interface DevToolsContextOptions {
  /** Nonce for styles injected outside the shadow root (PiP window). */
  styleNonce?: string
}

export function createDevToolsContext(client: StoreClient, options: DevToolsContextOptions = {}) {
  let tick = $state(0)
  // Shallow-clone each record so Svelte's keyed {#each} sees new object
  // references when records are mutated (e.g. finishedAt set on finish).
  let state: DevToolsState = $derived.by(() => {
    void tick
    const raw = client.getState()
    return {
      ...raw,
      requests: raw.requests.map((r) => ({ ...r })),
    }
  })
  let selectedVisitId = $state<number | null>(null)
  // Delivered once in the client's hello config; kept as local state so
  // clearAll() can wipe it (the store clears the persisted session too).
  let previousSessionRequests = $state<SessionRequestSummary[]>(client.hello.previousSessionRequests)
  let panelOpen = $state(false)
  let pipOpen = $state(false)
  let pipHandle: PipHandle | null = null
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
  const unsubscribe = client.subscribe(() => {
    tick++
  })

  function togglePanel() {
    // While popped out the trigger focuses the popup instead of toggling
    if (pipOpen) {
      pipHandle?.focus()
      return
    }
    panelOpen = !panelOpen
    client.setPanelOpen(panelOpen)

    saveSetting('panel', panelOpen ? 'open' : 'closed')
  }

  function openPip(): void {
    // Already popped out — just focus the existing window
    if (pipHandle) {
      pipHandle.focus()
      return
    }
    const handle = openPipWindow(client, {
      context: ctx,
      styleNonce: options.styleNonce,
      onClose: () => {
        // Popup gone (its close button, opener unload, or closePip) —
        // pipOpen flips back so the docked panel re-appears.
        pipOpen = false
        pipHandle = null
        saveSetting('pip', 'closed')
      },
    })
    // Popup blocked — fall back silently to the docked panel
    if (!handle) return
    pipHandle = handle
    pipOpen = true
    // Remember the preference only — never auto-reopened on load, since
    // programmatic window.open outside a user gesture is popup-blocked.
    saveSetting('pip', 'open')
  }

  function closePip(): void {
    pipHandle?.close()
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

  /**
   * Ids the request list is actually showing, in display order. Arrow keys used
   * to walk `state.requests` — the whole buffer — so with a filter active they
   * selected rows that were not in the list and the panel appeared to jump to
   * nothing. The list reports what it renders; if it has not yet (first frame),
   * fall back to the buffer.
   */
  let visibleRequestIds = $state<number[]>([])
  function setVisibleRequestIds(ids: number[]) {
    visibleRequestIds = ids
  }
  function navigableIds(): number[] {
    return visibleRequestIds.length > 0 ? visibleRequestIds : state.requests.map((r) => r.visitId)
  }

  function selectNextRequest() {
    const reqs = navigableIds().map((id) => ({ visitId: id }))
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
    const reqs = navigableIds().map((id) => ({ visitId: id }))
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
    client.clear()
    previousSessionRequests = []
    selectedVisitId = null
  }

  function replayVisit(visitId: number) {
    client.replayVisit(visitId)
  }

  function reload() {
    client.reload()
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
  const currentPageFeatures = $derived(currentPage ? extractPageFeatures(currentPage) : [])

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
    client.setPanelOpen(true)
  }

  function destroy() {
    unsubscribe()
    clearTimeout(notDetectedTimer)
    pipHandle?.close()
    if (mql && mqlHandler) {
      mql.removeEventListener('change', mqlHandler)
    }
  }

  const ctx = {
    get state() {
      return state
    },
    get currentPage() {
      return currentPage
    },
    get panelOpen() {
      return panelOpen
    },
    get pipOpen() {
      return pipOpen
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
      return previousSessionRequests
    },
    get showInertiaNotDetected() {
      return showInertiaNotDetected
    },
    get docsProvider() {
      return client.hello.docsProvider
    },
    get canAct() {
      return client.hello.canAct
    },
    get resolvedTheme() {
      return resolvedTheme
    },
    togglePanel,
    openPip,
    closePip,
    selectRequest,
    selectNextRequest,
    selectPrevRequest,
    setVisibleRequestIds,
    deselectRequest,
    setActiveTab,
    clearAll,
    replayVisit,
    reload,
    setRequestFilter,
    cycleTheme,
    destroy,
  }

  return ctx
}

export type DevToolsContext = ReturnType<typeof createDevToolsContext>
