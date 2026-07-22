import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import PanelContainer from './PanelContainer.svelte'
import { createDevToolsContext } from './stores.svelte'
import type { StoreClient } from '../core/client'
import type { DevToolsState } from '../core/types'
import { resetMediaQueries } from '../test-setup'

/**
 * The panel resize separators used to be pointer-only: role="separator" +
 * aria-label but no tabindex or key handler, so a keyboard user could not
 * operate them. This pins the horizontal (height) handle's keyboard behaviour;
 * the vertical (width) path is covered in RequestList.test.
 */
function fakeClient(): StoreClient {
  const state = { requests: [], currentPage: null } as unknown as DevToolsState
  return {
    hello: { docsProvider: 'inertiajs', previousSessionRequests: [], canAct: true },
    getState: () => state,
    subscribe: () => () => {},
    clear: () => {},
    setPanelOpen: () => {},
    replayVisit: () => {},
    reload: () => {},
  } as StoreClient
}

describe('PanelContainer resize handle keyboard', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMediaQueries()
  })
  afterEach(cleanup)

  it('resizes panel height with Up/Down and jumps with Home/End', async () => {
    const ctx = createDevToolsContext(fakeClient())
    const { container } = render(PanelContainer, { ctx } as never)
    const handle = container.querySelector('.resize-handle-top') as HTMLElement
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
    expect(handle.getAttribute('tabindex')).toBe('0')

    const now = () => Number(handle.getAttribute('aria-valuenow'))
    const min = Number(handle.getAttribute('aria-valuemin'))
    const start = now()

    // A horizontal separator grows height on ArrowUp (drag-up = grow).
    await fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(now()).toBe(start + 16)
    await fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(now()).toBe(start)
    await fireEvent.keyDown(handle, { key: 'Home' })
    expect(now()).toBe(min)
    // Left/Right must NOT affect a horizontal (height) separator.
    await fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(now()).toBe(min)
  })
})
