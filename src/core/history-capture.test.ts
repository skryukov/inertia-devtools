import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startHistoryCapture } from './history-capture'
import type { DevToolsStore } from './store'
import type { InertiaPage } from './protocol'

function makePage(overrides: Partial<InertiaPage> = {}): InertiaPage {
  return {
    component: 'Index',
    props: { title: 'Hello' },
    url: '/',
    version: '1',
    clearHistory: false,
    encryptHistory: false,
    flash: {},
    ...overrides,
  }
}

function makeInertiaState(page: InertiaPage | ArrayBuffer) {
  return { page, scrollRegions: [], documentScrollPosition: 0 }
}

function makeStoreMock(initialPage: InertiaPage | null = null): DevToolsStore & { _page: InertiaPage | null } {
  const mock = {
    _page: initialPage,
    captureEvent: vi.fn(),
    captureClientVisit: vi.fn(),
    getState: vi.fn(),
    subscribe: vi.fn(),
    clear: vi.fn(),
    setPanelOpen: vi.fn(),
    get currentPage() {
      return mock._page
    },
  } as unknown as DevToolsStore & { _page: InertiaPage | null }
  return mock
}

/** Wait for the setTimeout(0) inside scheduleEncryptedCheck to fire. */
function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

describe('startHistoryCapture', () => {
  let origPush: typeof history.pushState
  let origReplace: typeof history.replaceState

  beforeEach(() => {
    origPush = history.pushState
    origReplace = history.replaceState
    vi.useRealTimers()
  })

  afterEach(() => {
    history.pushState = origPush
    history.replaceState = origReplace
  })

  it('monkey-patches history.pushState and replaceState', () => {
    const store = makeStoreMock()
    const stop = startHistoryCapture(store)

    expect(history.pushState).not.toBe(origPush)
    expect(history.replaceState).not.toBe(origReplace)

    stop()
  })

  it('restores original methods on cleanup', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage = makePage({ props: { counter: 99 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    const patchedPush = history.pushState

    stop()

    expect(history.pushState).not.toBe(patchedPush)

    // Verify the intercept no longer fires
    store._page = newPage
    history.pushState(makeInertiaState(newPage), '', '/')
    expect(store.captureClientVisit).not.toHaveBeenCalled()
  })

  it('captures client visit on replaceState with changed page (synchronous)', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage = makePage({ props: { counter: 5 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    history.replaceState(makeInertiaState(newPage), '', '/')

    // Captured synchronously — no need to await
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)
    expect(store.captureClientVisit).toHaveBeenCalledWith('replace', newPage, oldPage)

    stop()
  })

  it('captures client visit on pushState with changed page (synchronous)', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage = makePage({ props: { counter: 1 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    history.pushState(makeInertiaState(newPage), '', '/')

    // Captured synchronously
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)
    expect(store.captureClientVisit).toHaveBeenCalledWith('push', newPage, oldPage)

    stop()
  })

  it('works with encrypted history (ArrayBuffer state, deferred)', async () => {
    const oldPage = makePage({ props: { counter: 0 }, encryptHistory: true })
    const newPage = makePage({ props: { counter: 1 }, encryptHistory: true })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    // Encrypted state: page is an ArrayBuffer — can't read synchronously
    history.replaceState(makeInertiaState(new ArrayBuffer(128)), '', '/')
    store._page = newPage // Inertia still updates in-memory page

    await flushTimers()

    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)
    expect(store.captureClientVisit).toHaveBeenCalledWith('replace', newPage, oldPage)

    stop()
  })

  it('ignores non-Inertia state objects', () => {
    const store = makeStoreMock(makePage())
    const stop = startHistoryCapture(store)

    history.pushState({ foo: 'bar' }, '', '/')
    history.pushState(null as unknown as object, '', '/')

    expect(store.captureClientVisit).not.toHaveBeenCalled()

    stop()
  })

  it('ignores when no currentPage (no baseline)', () => {
    const store = makeStoreMock(null)
    const stop = startHistoryCapture(store)

    history.pushState(makeInertiaState(makePage()), '', '/')

    expect(store.captureClientVisit).not.toHaveBeenCalled()

    stop()
  })

  it('ignores when page did not change (same reference — scroll save)', () => {
    const page = makePage({ props: { counter: 0 } })
    const store = makeStoreMock(page)
    const stop = startHistoryCapture(store)

    // replaceState but page data unchanged (e.g., scroll save)
    history.replaceState(makeInertiaState(page), '', '/')

    expect(store.captureClientVisit).not.toHaveBeenCalled()

    stop()
  })

  it('ignores when page did not change (different reference, same values)', () => {
    const page = makePage({ props: { counter: 0 } })
    const store = makeStoreMock(page)
    const stop = startHistoryCapture(store)

    // Scroll saves create a new state object with the same page data
    const clonedPage = makePage({ props: { counter: 0 } })
    history.replaceState(makeInertiaState(clonedPage), '', '/')

    expect(store.captureClientVisit).not.toHaveBeenCalled()

    stop()
  })

  it('suppresses when inertia:before fired (server visit)', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage = makePage({ props: { counter: 1 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    // Simulate server visit: before fires first, then state changes
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))

    history.replaceState(makeInertiaState(newPage), '', '/')

    expect(store.captureClientVisit).not.toHaveBeenCalled()

    stop()
  })

  it('captures client push even when navigate fires afterward', () => {
    const oldPage = makePage({ url: '/page1', props: { counter: 0 } })
    const newPage = makePage({ url: '/page1?q=1', props: { counter: 1 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    // Client push: no inertia:before, state change happens, then navigate fires
    history.pushState(makeInertiaState(newPage), '', '/page1?q=1')

    // Captured synchronously BEFORE navigate fires
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)
    expect(store.captureClientVisit).toHaveBeenCalledWith('push', newPage, oldPage)

    // Navigate fires later — should not cause a duplicate
    document.dispatchEvent(new CustomEvent('inertia:navigate', { detail: { page: newPage } }))

    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)

    stop()
  })

  it('suppresses server visit even with concurrent deferred requests', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage1 = makePage({ props: { counter: 1 } })
    const newPage2 = makePage({ props: { counter: 2 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    // Two server visits (e.g., main + deferred)
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))

    // Both state changes should be suppressed
    history.replaceState(makeInertiaState(newPage1), '', '/')
    expect(store.captureClientVisit).not.toHaveBeenCalled()

    history.replaceState(makeInertiaState(newPage2), '', '/')
    expect(store.captureClientVisit).not.toHaveBeenCalled()

    stop()
  })

  it('decrements pendingServerVisits on cancelled finish', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage = makePage({ props: { counter: 1 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    // Server visit starts then gets cancelled (finish with cancelled flag)
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    document.dispatchEvent(new CustomEvent('inertia:finish', { detail: { visit: { cancelled: true } } }))

    // Counter back to 0 — client visit should be captured
    history.replaceState(makeInertiaState(newPage), '', '/')
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)

    stop()
  })

  it('decrements pendingServerVisits on interrupted finish', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage = makePage({ props: { counter: 1 } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    // Server visit starts then gets interrupted
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    document.dispatchEvent(new CustomEvent('inertia:finish', { detail: { visit: { interrupted: true } } }))

    // Counter back to 0 — client visit should be captured
    history.replaceState(makeInertiaState(newPage), '', '/')
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)

    stop()
  })

  it('suppresses encrypted history during server visit', async () => {
    const oldPage = makePage({ props: { counter: 0 }, encryptHistory: true })
    const newPage = makePage({ props: { counter: 1 }, encryptHistory: true })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    // Server visit with encrypted history
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))

    history.replaceState(makeInertiaState(new ArrayBuffer(128)), '', '/')
    store._page = newPage

    await flushTimers()

    expect(store.captureClientVisit).not.toHaveBeenCalled()

    stop()
  })

  it('detects URL changes', () => {
    const oldPage = makePage({ url: '/page1' })
    const newPage = makePage({ url: '/page2' })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    history.pushState(makeInertiaState(newPage), '', '/page2')

    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)

    stop()
  })

  it('detects component changes', () => {
    const oldPage = makePage({ component: 'PageA' })
    const newPage = makePage({ component: 'PageB' })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    history.pushState(makeInertiaState(newPage), '', '/')

    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)

    stop()
  })

  it('detects flash changes', () => {
    const oldPage = makePage({ flash: {} })
    const newPage = makePage({ flash: { notice: 'Created!' } })
    const store = makeStoreMock(oldPage)
    const stop = startHistoryCapture(store)

    history.replaceState(makeInertiaState(newPage), '', '/')

    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)

    stop()
  })

  it('isolates errors — does not throw', () => {
    const oldPage = makePage({ props: { counter: 0 } })
    const newPage = makePage({ props: { counter: 1 } })
    const store = makeStoreMock(oldPage)
    ;(store.captureClientVisit as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom')
    })
    const stop = startHistoryCapture(store)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    const groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    history.pushState(makeInertiaState(newPage), '', '/')

    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
    groupSpy.mockRestore()
    groupEndSpy.mockRestore()
    stop()
  })

  it('still calls the original history methods', () => {
    const store = makeStoreMock(makePage())
    const pushSpy = vi.fn()
    const replaceSpy = vi.fn()

    history.pushState = pushSpy
    history.replaceState = replaceSpy
    origPush = pushSpy as unknown as typeof origPush
    origReplace = replaceSpy as unknown as typeof origReplace

    const stop = startHistoryCapture(store)

    const state = { some: 'data' }
    history.pushState(state, '', '/test')
    history.replaceState(state, '', '/test2')

    expect(pushSpy).toHaveBeenCalledWith(state, '', '/test')
    expect(replaceSpy).toHaveBeenCalledWith(state, '', '/test2')

    stop()
  })

  it('captures client visit after prefetch requests (prefetch never triggers state change)', () => {
    const page = makePage({ url: '/home', props: { v: 1 } })
    const clientPage = makePage({ url: '/home', props: { v: 99 } })
    const store = makeStoreMock(page)
    const stop = startHistoryCapture(store)

    // Prefetch 3 pages: inertia:before fires with visit.prefetch = true,
    // but no history.pushState/replaceState ever follows (data is just cached).
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(
        new CustomEvent('inertia:before', {
          detail: { visit: { prefetch: true, url: `/page${i}`, method: 'get' } },
        }),
      )
    }

    // Client visit must be captured immediately — counter should still be 0.
    history.replaceState(makeInertiaState(clientPage), '', '/home')
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)
    expect(store.captureClientVisit).toHaveBeenCalledWith('replace', clientPage, page)

    stop()
  })

  it('captures client visit after server visits that update currentPage before replaceState', () => {
    // Reproduces: inertia:beforeUpdate sets lastPage BEFORE history.replaceState fires,
    // so store.currentPage === directPage and hasPageChanged returns false.
    // Without the fix, pendingServerVisits leaks and subsequent client visits are dropped.
    const pageA = makePage({ url: '/a', props: { counter: 0 } })
    const pageB = makePage({ url: '/b', props: { counter: 1 } })
    const pageC = makePage({ url: '/b', props: { counter: 2 } })
    const store = makeStoreMock(pageA)
    const stop = startHistoryCapture(store)

    // Server visit to /b: before fires, then beforeUpdate updates currentPage,
    // THEN replaceState fires with the same page already in store.currentPage.
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    store._page = pageB // simulates correlator updating lastPage via beforeUpdate
    history.replaceState(makeInertiaState(pageB), '', '/b')
    expect(store.captureClientVisit).not.toHaveBeenCalled()

    // Now a client visit: pendingServerVisits should be 0, so this must be captured.
    history.replaceState(makeInertiaState(pageC), '', '/b')
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)
    expect(store.captureClientVisit).toHaveBeenCalledWith('replace', pageC, pageB)

    stop()
  })

  it('captures client visit after multiple server navigations', () => {
    const page1 = makePage({ url: '/page1', props: { v: 1 } })
    const page2 = makePage({ url: '/page2', props: { v: 2 } })
    const page3 = makePage({ url: '/page3', props: { v: 3 } })
    const clientPage = makePage({ url: '/page3', props: { v: 99 } })
    const store = makeStoreMock(page1)
    const stop = startHistoryCapture(store)

    // Navigate to /page2 (server visit)
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    store._page = page2
    history.pushState(makeInertiaState(page2), '', '/page2')

    // Navigate to /page3 (server visit)
    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    store._page = page3
    history.pushState(makeInertiaState(page3), '', '/page3')

    expect(store.captureClientVisit).not.toHaveBeenCalled()

    // Client visit: must be captured even after 2 server visits
    history.replaceState(makeInertiaState(clientPage), '', '/page3')
    expect(store.captureClientVisit).toHaveBeenCalledTimes(1)
    expect(store.captureClientVisit).toHaveBeenCalledWith('replace', clientPage, page3)

    stop()
  })

  it('captures each rapid state change individually', () => {
    const page0 = makePage({ props: { counter: 0 } })
    const page1 = makePage({ props: { counter: 1 } })
    const page2 = makePage({ props: { counter: 2 } })
    const store = makeStoreMock(page0)
    const stop = startHistoryCapture(store)

    // Two rapid replaceState calls (e.g., replaceProp called twice quickly)
    history.replaceState(makeInertiaState(page1), '', '/')
    history.replaceState(makeInertiaState(page2), '', '/')

    // Each change captured synchronously
    expect(store.captureClientVisit).toHaveBeenCalledTimes(2)
    expect(store.captureClientVisit).toHaveBeenCalledWith('replace', page1, page0)
    expect(store.captureClientVisit).toHaveBeenCalledWith('replace', page2, page0)

    stop()
  })
})
