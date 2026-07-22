import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import RequestList from './RequestList.svelte'
import { createDevToolsContext } from './stores.svelte'
import type { StoreClient } from '../core/client'
import type { DevToolsState, RequestRecord } from '../core/types'
import { resetMediaQueries } from '../test-setup'

/**
 * Guards U1 — round 3's "single most damaging bug": a network-failed request
 * rendered with a green success dot. statusColor now returns red for
 * `failed`, and this pins it at the DOM level so it cannot regress silently.
 */

function record(over: Partial<RequestRecord>): RequestRecord {
  return {
    visitId: 1,
    type: 'full',
    method: 'GET',
    url: '/posts',
    startedAt: 1,
    finishedAt: 5,
    duration: 4,
    completed: true,
    cancelled: false,
    interrupted: false,
    events: [],
    features: [],
    diagnostics: [],
    ...over,
  } as RequestRecord
}

function fakeClient(requests: RequestRecord[]): StoreClient {
  const state = { requests, currentPage: null } as unknown as DevToolsState
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

function dotColors(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('.status-dot')].map((el) => el.style.background)
}

describe('RequestList status dot', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMediaQueries()
  })
  afterEach(cleanup)

  it('paints a failed request red, not green — even with no status', () => {
    // The exact repro: a request that never reached the server has finishedAt
    // set (finish runs in .finally) but no status, so it used to fall through
    // to green.
    const ctx = createDevToolsContext(fakeClient([record({ failed: true, status: undefined })]))
    const { container } = render(RequestList, { ctx } as never)
    expect(dotColors(container)).toContain('var(--dt-red)')
    expect(dotColors(container)).not.toContain('var(--dt-green)')
  })

  it('still paints a clean 200 green', () => {
    const ctx = createDevToolsContext(fakeClient([record({ status: 200 })]))
    const { container } = render(RequestList, { ctx } as never)
    expect(dotColors(container)).toContain('var(--dt-green)')
  })

  it('paints an in-flight request with the accent, not failed-red', () => {
    const ctx = createDevToolsContext(fakeClient([record({ finishedAt: undefined, completed: false })]))
    const { container } = render(RequestList, { ctx } as never)
    expect(dotColors(container)).toContain('var(--dt-accent)')
  })

  it('pulls focus into the list when the panel is opened by the user', () => {
    // Resurrects the documented arrow-key browsing: it was unreachable because
    // togglePanel opened the panel but focus stayed in the host app, and
    // DevToolsApp refuses arrows unless focus is inside the devtools.
    const ctx = createDevToolsContext(fakeClient([record({ status: 200 })]))
    ctx.togglePanel() // deliberate open raises the focus request
    const { container } = render(RequestList, { ctx } as never)
    expect(document.activeElement).toBe(container.querySelector('.request-list'))
  })

  it('does NOT steal focus when the panel state is merely restored', () => {
    // No togglePanel() call — this models the persisted-open restore on page
    // load, which must not yank focus from the host app on every view.
    const ctx = createDevToolsContext(fakeClient([record({ status: 200 })]))
    const { container } = render(RequestList, { ctx } as never)
    expect(document.activeElement).not.toBe(container.querySelector('.request-list'))
  })
})

describe('RequestList filter chips', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMediaQueries()
  })
  afterEach(cleanup)

  it('exposes toggle state via aria-pressed, flipping on click', async () => {
    // Two categories (a GET visit + a POST mutation) make the filter chips
    // render. RequestList chips conveyed their on/off state only visually —
    // EventsTab/PageView already set aria-pressed, so a screen reader could not
    // tell a RequestList chip was toggled off.
    const ctx = createDevToolsContext(
      fakeClient([record({ visitId: 1, method: 'GET' }), record({ visitId: 2, method: 'POST' })]),
    )
    const { container } = render(RequestList, { ctx } as never)
    const chips = [...container.querySelectorAll('.filter-chip')]
    expect(chips.length).toBeGreaterThanOrEqual(2)
    // Nothing hidden yet — every category is shown, so every chip is pressed.
    expect(chips.every((c) => c.getAttribute('aria-pressed') === 'true')).toBe(true)

    await fireEvent.click(chips[0])
    // The clicked category is now hidden → its chip reports not-pressed.
    expect(container.querySelectorAll('.filter-chip')[0].getAttribute('aria-pressed')).toBe('false')
  })
})
