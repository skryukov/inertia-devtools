import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import TriggerIcon from './TriggerIcon.svelte'

/**
 * Covers the drag-vs-click split. This test could not exist before the vitest
 * config fix — the component takes a context whose creation calls
 * `window.matchMedia`, which jsdom does not implement.
 */
function ctxStub() {
  return {
    togglePanel: vi.fn(),
    panelOpen: false,
    pipOpen: false,
    state: { requests: [], currentPage: null },
    inertiaNotDetected: false,
  }
}

function trigger(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.trigger')
  if (!el) throw new Error('trigger not rendered')
  return el as HTMLElement
}

/** jsdom implements neither pointer-capture method. */
function stubPointerCapture(el: HTMLElement) {
  el.setPointerCapture = () => {}
  el.releasePointerCapture = () => {}
}

describe('TriggerIcon drag vs click', () => {
  afterEach(cleanup)

  it('toggles the panel on a plain click', async () => {
    const ctx = ctxStub()
    const { container } = render(TriggerIcon, { ctx } as never)
    const el = trigger(container)
    stubPointerCapture(el)

    await fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 })
    await fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 })
    await fireEvent.click(el)

    expect(ctx.togglePanel).toHaveBeenCalledTimes(1)
  })

  it('does NOT toggle after a real drag', async () => {
    // pointerup fires before click and cleared `dragging`, so the click guard
    // never saw a drag — every reposition of the trigger opened or closed the
    // panel.
    const ctx = ctxStub()
    const { container } = render(TriggerIcon, { ctx } as never)
    const el = trigger(container)
    stubPointerCapture(el)

    await fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 })
    await fireEvent.pointerMove(el, { clientX: 240, clientY: 180, pointerId: 1 })
    await fireEvent.pointerUp(el, { clientX: 240, clientY: 180, pointerId: 1 })
    await fireEvent.click(el)

    expect(ctx.togglePanel).not.toHaveBeenCalled()
  })

  it('treats sub-threshold jitter as a click, not a drag', async () => {
    // A click with 2px of hand tremor must still toggle; otherwise the fix for
    // the drag case breaks the ordinary one on a trackpad.
    const ctx = ctxStub()
    const { container } = render(TriggerIcon, { ctx } as never)
    const el = trigger(container)
    stubPointerCapture(el)

    await fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 })
    await fireEvent.pointerMove(el, { clientX: 101, clientY: 102, pointerId: 1 })
    await fireEvent.pointerUp(el, { clientX: 101, clientY: 102, pointerId: 1 })
    await fireEvent.click(el)

    expect(ctx.togglePanel).toHaveBeenCalledTimes(1)
  })

  it('recovers for the next click after a drag', async () => {
    const ctx = ctxStub()
    const { container } = render(TriggerIcon, { ctx } as never)
    const el = trigger(container)
    stubPointerCapture(el)

    await fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 })
    await fireEvent.pointerMove(el, { clientX: 240, clientY: 180, pointerId: 1 })
    await fireEvent.pointerUp(el, { clientX: 240, clientY: 180, pointerId: 1 })
    await fireEvent.click(el)
    expect(ctx.togglePanel).not.toHaveBeenCalled()

    // suppressClick must be one-shot, or the trigger goes permanently dead
    // after its first reposition.
    await fireEvent.pointerDown(el, { clientX: 240, clientY: 180, pointerId: 1 })
    await fireEvent.pointerUp(el, { clientX: 240, clientY: 180, pointerId: 1 })
    await fireEvent.click(el)
    expect(ctx.togglePanel).toHaveBeenCalledTimes(1)
  })

  it('survives a pointercancel without throwing at the host', async () => {
    // macOS back-swipe / touch gesture takeover: capture is already gone, so
    // releasePointerCapture throws InvalidStateError into the host's Sentry.
    const ctx = ctxStub()
    const { container } = render(TriggerIcon, { ctx } as never)
    const el = trigger(container)
    el.setPointerCapture = () => {}
    el.releasePointerCapture = () => {
      throw new DOMException('already released', 'InvalidStateError')
    }

    await fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 })
    await fireEvent.pointerMove(el, { clientX: 240, clientY: 180, pointerId: 1 })
    await expect(fireEvent.pointerCancel(el, { clientX: 240, clientY: 180, pointerId: 1 })).resolves.toBeTruthy()
  })
})

describe('TriggerIcon stays on screen (B11)', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('clamps a restored off-screen position into the current viewport', () => {
    // Saved on a wide monitor, reopened on a laptop: the right/bottom offset
    // used to exceed the viewport and put the button ~1200px off-screen with no
    // way back but clearing localStorage.
    localStorage.setItem('inertia-devtools-trigger-pos', JSON.stringify({ x: 5000, y: 5000 }))
    const { container } = render(TriggerIcon, { ctx: ctxStub() } as never)
    const el = trigger(container)

    // jsdom's viewport is 1024x768; 36px icon → max offset 988 / 732.
    expect(parseInt(el.style.right)).toBeLessThanOrEqual(window.innerWidth - 36)
    expect(parseInt(el.style.bottom)).toBeLessThanOrEqual(window.innerHeight - 36)
  })

  it('re-clamps when the window shrinks', async () => {
    localStorage.setItem('inertia-devtools-trigger-pos', JSON.stringify({ x: 900, y: 700 }))
    const { container } = render(TriggerIcon, { ctx: ctxStub() } as never)
    const el = trigger(container)

    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true })
    await fireEvent(window, new Event('resize'))

    expect(parseInt(el.style.right)).toBeLessThanOrEqual(400 - 36)
    expect(parseInt(el.style.bottom)).toBeLessThanOrEqual(300 - 36)
    // restore for other tests
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })
})
