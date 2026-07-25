import { describe, it, expect, afterEach, vi } from 'vitest'
import { createInertiaDevtools, destroyInertiaDevtools, shouldAutoInit } from './entry'
import { mediaQuery } from './test-setup'

/**
 * `entry.ts` had no test at all, which is how `destroyInertiaDevtools()` shipped
 * as a half-teardown with a doc comment claiming it was "used by the HMR hook
 * below" — there is no HMR hook, and nothing called the function. It stopped
 * capture and left the shadow host, the Svelte app, its document keydown
 * listener and the store subscription behind, so init-after-destroy produced a
 * second set of each: the exact leak the previous commit claimed to have fixed,
 * relocated from the capture layer to the UI layer.
 */

function hosts() {
  return document.querySelectorAll('#inertia-devtools-host')
}

/** Drain microtasks and one macrotask — enough for teardown, NOT for mounting. */
async function settle() {
  // Sequential on purpose — each tick has to land before the next is queued.
  // eslint-disable-next-line no-await-in-loop
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

/**
 * Poll until the Svelte app is actually in the DOM.
 *
 * A fixed delay is not enough and quietly lies: mountUI awaits three dynamic
 * imports, and with a flat `settle()` the host element existed while
 * `#inertia-devtools-root` was still empty — so assertions about listeners and
 * unmounting passed by measuring nothing.
 */
async function waitForMount(timeoutMs = 5000) {
  const start = Date.now()
  for (;;) {
    const root = hosts()[0]?.shadowRoot?.querySelector('#inertia-devtools-root')
    if (root && root.childNodes.length > 0) return
    if (Date.now() - start > timeoutMs) throw new Error('devtools UI never mounted')
    // eslint-disable-next-line no-await-in-loop -- polling is inherently serial
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('createInertiaDevtools / destroyInertiaDevtools', () => {
  afterEach(() => {
    destroyInertiaDevtools()
    for (const el of hosts()) el.remove()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('mounts exactly one shadow host', async () => {
    createInertiaDevtools()
    await waitForMount()
    expect(hosts()).toHaveLength(1)
  })

  it('removes the host on destroy', async () => {
    createInertiaDevtools()
    await waitForMount()
    destroyInertiaDevtools()
    await settle()
    expect(hosts()).toHaveLength(0)
  })

  it('does not stack a second host across destroy/init cycles', async () => {
    // The regression this exists for. `initialized` reset but the DOM did not,
    // so every cycle added another trigger icon and another keydown listener.
    /* eslint-disable no-await-in-loop -- each cycle must complete before the next */
    for (let i = 0; i < 3; i++) {
      createInertiaDevtools()
      await waitForMount()
      destroyInertiaDevtools()
      await settle()
    }
    /* eslint-enable no-await-in-loop */
    createInertiaDevtools()
    await waitForMount()
    expect(hosts()).toHaveLength(1)
  })

  it('releases the init guards so a later init takes effect', async () => {
    createInertiaDevtools()
    await waitForMount()
    destroyInertiaDevtools()
    expect(window.__INERTIA_DEVTOOLS__).toBeUndefined()
    expect(window.__INERTIA_DEVTOOLS_STORE__).toBeUndefined()

    createInertiaDevtools()
    await waitForMount()
    expect(window.__INERTIA_DEVTOOLS__).toBe(true)
    expect(hosts()).toHaveLength(1)
  })

  it('leaves nothing mounted when destroy races the UI chunk', async () => {
    // mountUI awaits a dynamic import. A destroy landing inside that window used
    // to leave the freshly-mounted app orphaned, with no teardown holding it.
    createInertiaDevtools()
    destroyInertiaDevtools()
    await settle()
    expect(hosts()).toHaveLength(0)
  })

  it('unmounts the app, not just the host element', async () => {
    // Removing the host alone makes the DOM assertions above pass while the
    // Svelte app stays alive: its document keydown listener is bound to
    // `document`, which outlives the detached host, so the panel keeps
    // answering Alt+Shift+D after it is gone. Counting the listener is the only
    // way to tell the two teardowns apart.
    const added: unknown[] = []
    const removed: unknown[] = []
    const realAdd = document.addEventListener.bind(document)
    const realRemove = document.removeEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation((type, fn, opts) => {
      if (type === 'keydown') added.push(fn)
      return realAdd(type, fn, opts)
    })
    vi.spyOn(document, 'removeEventListener').mockImplementation((type, fn, opts) => {
      if (type === 'keydown') removed.push(fn)
      return realRemove(type, fn, opts)
    })

    createInertiaDevtools()
    await waitForMount()
    expect(added.length).toBeGreaterThan(0)

    destroyInertiaDevtools()
    await settle()
    expect(removed).toHaveLength(added.length)
  })

  it('tears the reactive context down, not just the component tree', async () => {
    // Svelte's unmount disposes effects, but the context is created OUTSIDE the
    // effect graph — `createDevToolsContext` subscribes to the store and to
    // matchMedia in plain module code. Without an explicit destroy those two
    // outlive every unmount, and the OS-theme listener is the one that can be
    // counted from here.
    const mql = mediaQuery('(prefers-color-scheme: dark)')
    const before = mql.listenerCount()

    createInertiaDevtools()
    await waitForMount()
    expect(mql.listenerCount()).toBe(before + 1)

    destroyInertiaDevtools()
    await settle()
    expect(mql.listenerCount()).toBe(before)
  })

  it('is a no-op when called without an active instance', () => {
    expect(() => destroyInertiaDevtools()).not.toThrow()
  })

  it('respects enabled: false', async () => {
    createInertiaDevtools({ enabled: false })
    await settle()
    expect(hosts()).toHaveLength(0)
  })
})

describe('shouldAutoInit (fail-closed production gate)', () => {
  it('boots when Vite says dev (import.meta.env.DEV === true)', () => {
    expect(shouldAutoInit(true, () => 'production')).toBe(true)
  })

  it('does NOT boot when Vite says build (DEV === false), whatever NODE_ENV says', () => {
    expect(shouldAutoInit(false, () => 'development')).toBe(false)
  })

  it('boots for a bundled dev build with no Vite signal', () => {
    expect(shouldAutoInit(undefined, () => 'development')).toBe(true)
  })

  it('does NOT boot for a bundled production build', () => {
    expect(shouldAutoInit(undefined, () => 'production')).toBe(false)
  })

  it('does NOT boot when there is no signal at all — the CDN/importmap browser case', () => {
    // The bug: unbundled page, `process` undefined, reading it throws. The old
    // gate returned false-is-prod => auto-booted full capture onto a production
    // page and exposed every record on window. Fail closed instead.
    expect(
      shouldAutoInit(undefined, () => {
        throw new ReferenceError('process is not defined')
      }),
    ).toBe(false)
  })

  it('does NOT boot when NODE_ENV reads undefined — a browser process shim exposing env but no value', () => {
    // The residual fail-OPEN the review caught: `process.env` exists so the read
    // does not throw, but NODE_ENV is unset. `!== 'production'` booted here;
    // `=== 'development'` refuses. Flip the operator back and this fails.
    expect(shouldAutoInit(undefined, () => undefined)).toBe(false)
  })

  it('does NOT boot for an unrecognized NODE_ENV like a custom "staging" mode', () => {
    expect(shouldAutoInit(undefined, () => 'staging')).toBe(false)
  })
})
