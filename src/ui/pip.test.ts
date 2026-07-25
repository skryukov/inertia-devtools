import { describe, it, expect, vi } from 'vitest'
import { openPipWindow, PIP_WINDOW_NAME, type PipWindowOptions } from './pip'
import { getBaseStyles } from './mount'
import type { StoreClient } from '../core/client'
import type { DevToolsContext } from './stores.svelte'

function createEventTarget() {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    addEventListener: vi.fn((type: string, fn: EventListener) => {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(fn)
    }),
    removeEventListener: vi.fn((type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn)
    }),
    dispatch(type: string) {
      for (const fn of listeners.get(type) ?? []) {
        fn(new Event(type))
      }
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0
    },
  }
}

function createFakeWindow() {
  const target = createEventTarget()
  const win = {
    ...target,
    document: document.implementation.createHTMLDocument(''),
    focus: vi.fn(),
    // A real window fires pagehide when closed
    close: vi.fn(() => target.dispatch('pagehide')),
  }
  return win
}

type FakeWindow = ReturnType<typeof createFakeWindow>
type FakeOpener = ReturnType<typeof createEventTarget>

const fakeClient = { getState: () => ({}) } as unknown as StoreClient
const fakeContext = { resolvedTheme: 'dark' } as unknown as DevToolsContext

function open(
  overrides: Partial<PipWindowOptions> = {},
  win: FakeWindow = createFakeWindow(),
  opener: FakeOpener = createEventTarget(),
) {
  const handle = openPipWindow(fakeClient, {
    context: fakeContext,
    openWindow: vi.fn(() => win as unknown as Window),
    mountApp: vi.fn(async () => undefined),
    openerWindow: opener as unknown as Window,
    ...overrides,
  })
  return { handle, win, opener }
}

describe('openPipWindow', () => {
  it('returns null when the popup is blocked', () => {
    const onClose = vi.fn()
    const handle = openPipWindow(fakeClient, {
      context: fakeContext,
      openWindow: () => null,
      mountApp: vi.fn(async () => undefined),
      openerWindow: createEventTarget() as unknown as Window,
      onClose,
    })
    expect(handle).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('returns null when window.open throws', () => {
    const handle = openPipWindow(fakeClient, {
      context: fakeContext,
      openWindow: () => {
        throw new Error('blocked')
      },
      mountApp: vi.fn(async () => undefined),
      openerWindow: createEventTarget() as unknown as Window,
    })
    expect(handle).toBeNull()
  })

  it('opens a named about:blank popup with size features', () => {
    const openWindow = vi.fn(() => createFakeWindow() as unknown as Window)
    openPipWindow(fakeClient, {
      context: fakeContext,
      openWindow,
      mountApp: vi.fn(async () => undefined),
      openerWindow: createEventTarget() as unknown as Window,
    })
    expect(openWindow).toHaveBeenCalledWith('', PIP_WINDOW_NAME, 'width=900,height=500,popup')
  })

  it('respects custom width and height', () => {
    const openWindow = vi.fn(() => createFakeWindow() as unknown as Window)
    openPipWindow(fakeClient, {
      context: fakeContext,
      width: 640,
      height: 480,
      openWindow,
      mountApp: vi.fn(async () => undefined),
      openerWindow: createEventTarget() as unknown as Window,
    })
    expect(openWindow).toHaveBeenCalledWith('', PIP_WINDOW_NAME, 'width=640,height=480,popup')
  })

  it('wipes a recycled document and sets the title', () => {
    const win = createFakeWindow()
    win.document.head.innerHTML = '<style>stale</style>'
    win.document.body.innerHTML = '<p>stale</p>'
    open({}, win)
    expect(win.document.title).toBe('Inertia DevTools')
    expect(win.document.body.textContent).not.toContain('stale')
    expect(win.document.head.querySelectorAll('style')).toHaveLength(1)
    expect(win.document.head.querySelector('style')?.textContent).not.toContain('stale')
  })

  it('injects :root-scoped base styles', () => {
    const { win } = open()
    const style = win.document.head.querySelector('style')
    expect(style?.textContent).toContain(':root {')
    expect(style?.textContent).toContain(':root[data-theme="light"]')
    expect(style?.textContent).not.toContain(':host')
    expect(style?.textContent).toContain('--dt-bg:')
  })

  it('applies the style nonce when provided', () => {
    const { win } = open({ styleNonce: 'abc123' })
    const style = win.document.head.querySelector('style')
    expect(style?.nonce).toBe('abc123')
  })

  it('applies the current theme to the popup document element', () => {
    const context = { resolvedTheme: 'light' } as unknown as DevToolsContext
    const { win } = open({ context })
    expect(win.document.documentElement.dataset.theme).toBe('light')
  })

  it('mounts the app into a container inside the popup document', () => {
    const mountApp = vi.fn(async () => undefined)
    const { win } = open({ mountApp, styleNonce: 'n1' })
    const container = win.document.getElementById('inertia-devtools-root')
    expect(container).not.toBeNull()
    expect(container?.ownerDocument).toBe(win.document)
    expect(mountApp).toHaveBeenCalledWith(container, fakeClient, {
      sharedCtx: fakeContext,
      pip: true,
      styleNonce: 'n1',
    })
  })

  it('close() closes the window and fires onClose exactly once', () => {
    const onClose = vi.fn()
    const { handle, win } = open({ onClose })
    handle?.close()
    expect(win.close).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    // A late pagehide from the closing window must not fire onClose again
    win.dispatch('pagehide')
    handle?.close()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose when the popup itself closes (pagehide)', () => {
    const onClose = vi.fn()
    const { win } = open({ onClose })
    win.dispatch('pagehide')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose from the win.closed poll when no pagehide arrives', () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      // A window that closes WITHOUT dispatching pagehide (OS controls, mobile).
      const win = { ...createFakeWindow(), closed: false }
      // An opener that actually schedules timers so the backstop can run.
      const opener = Object.assign(createEventTarget(), {
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
      })
      open({ onClose }, win as never, opener as never)

      vi.advanceTimersByTime(600)
      expect(onClose).not.toHaveBeenCalled() // still open

      win.closed = true
      vi.advanceTimersByTime(600)
      expect(onClose).toHaveBeenCalledTimes(1)

      // The interval is cleared — no further firings.
      vi.advanceTimersByTime(2000)
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the popup when the opener unloads', () => {
    for (const event of ['beforeunload', 'pagehide'] as const) {
      const onClose = vi.fn()
      const { win, opener } = open({ onClose })
      opener.dispatch(event)
      expect(win.close).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })

  it('unmounts the app once the popup is gone', async () => {
    const unmountApp = vi.fn()
    const mountApp = vi.fn(async () => unmountApp)
    const { handle } = open({ mountApp })
    expect(unmountApp).not.toHaveBeenCalled()
    handle?.close()
    await Promise.resolve()
    expect(unmountApp).toHaveBeenCalledTimes(1)
  })

  it('removes opener listeners once the popup is gone', () => {
    const { handle, opener } = open()
    expect(opener.listenerCount('beforeunload')).toBe(1)
    expect(opener.listenerCount('pagehide')).toBe(1)
    handle?.close()
    expect(opener.listenerCount('beforeunload')).toBe(0)
    expect(opener.listenerCount('pagehide')).toBe(0)
  })

  it('focus() focuses the popup window', () => {
    const { handle, win } = open()
    handle?.focus()
    expect(win.focus).toHaveBeenCalledTimes(1)
  })
})

describe('getBaseStyles', () => {
  it('scopes to :host by default (docked Shadow DOM shell)', () => {
    const css = getBaseStyles()
    expect(css).toContain(':host {')
    expect(css).toContain(':host([data-theme="light"])')
    expect(css).not.toContain(':root')
  })

  it('scopes to :root for the PiP window document', () => {
    const css = getBaseStyles(':root')
    expect(css).toContain(':root {')
    expect(css).toContain(':root[data-theme="light"]')
    expect(css).not.toContain(':host')
  })
})
