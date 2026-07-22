import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
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
})
