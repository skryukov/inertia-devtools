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
