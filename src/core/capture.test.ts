import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startCapture } from './capture'
import { INERTIA_DOM_EVENTS } from './protocol'
import type { DevToolsStore } from './store'

function makeStoreMock(): DevToolsStore {
  return {
    captureEvent: vi.fn(),
    getState: vi.fn(),
    subscribe: vi.fn(),
    clear: vi.fn(),
    setPanelOpen: vi.fn(),
  } as unknown as DevToolsStore
}

describe('startCapture', () => {
  let addSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    addSpy = vi.spyOn(document, 'addEventListener')
    removeSpy = vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('attaches listeners for all Inertia events', () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    expect(addSpy).toHaveBeenCalledTimes(INERTIA_DOM_EVENTS.length)
    for (const name of INERTIA_DOM_EVENTS) {
      expect(addSpy).toHaveBeenCalledWith(name, expect.any(Function))
    }

    stop()
  })

  it('forwards events to store.captureEvent', () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    const detail = { visit: { url: '/test', method: 'get' } }
    document.dispatchEvent(new CustomEvent('inertia:before', { detail }))

    expect(store.captureEvent).toHaveBeenCalledTimes(1)
    expect(store.captureEvent).toHaveBeenCalledWith('inertia:before', expect.any(Event))

    stop()
  })

  it('isolates errors — does not throw when store.captureEvent throws', () => {
    const store = makeStoreMock()
    ;(store.captureEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom')
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    const groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const stop = startCapture(store)

    expect(() => {
      document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    }).not.toThrow()

    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
    groupSpy.mockRestore()
    groupEndSpy.mockRestore()
    stop()
  })

  it('cleanup removes all listeners', () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    stop()

    expect(removeSpy).toHaveBeenCalledTimes(INERTIA_DOM_EVENTS.length)
    for (const name of INERTIA_DOM_EVENTS) {
      expect(removeSpy).toHaveBeenCalledWith(name, expect.any(Function))
    }
  })

  it('multiple events forwarded independently', () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    document.dispatchEvent(new CustomEvent('inertia:before', { detail: { a: 1 } }))
    document.dispatchEvent(new CustomEvent('inertia:navigate', { detail: { b: 2 } }))

    expect(store.captureEvent).toHaveBeenCalledTimes(2)
    expect((store.captureEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('inertia:before')
    expect((store.captureEvent as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe('inertia:navigate')

    stop()
  })

  it('does not forward events after cleanup', () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    stop()

    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    expect(store.captureEvent).not.toHaveBeenCalled()
  })
})
