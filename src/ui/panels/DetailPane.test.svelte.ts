import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import DetailPane from './DetailPane.svelte'
import { createDevToolsContext } from '../stores.svelte'
import type { StoreClient } from '../../core/client'
import type { DevToolsState, RequestRecord } from '../../core/types'
import { resetMediaQueries } from '../../test-setup'

/**
 * Guards the Replay double-submit fix. Replaying a GET re-issues a real request
 * against the host app, so a rapid double-click used to fire it twice with no
 * in-flight feedback. Replay now disables + shows "Replaying…" for a cooldown.
 */

function getRecord(over: Partial<RequestRecord> = {}): RequestRecord {
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
    page: { component: 'Posts', props: {}, url: '/posts', version: null },
    ...over,
  } as RequestRecord
}

function fakeClient(replayVisit: () => void): StoreClient {
  const state = { requests: [getRecord()], currentPage: null } as unknown as DevToolsState
  return {
    hello: { docsProvider: 'inertiajs', previousSessionRequests: [], canAct: true, sourceLinks: false },
    getState: () => state,
    subscribe: () => () => {},
    clear: () => {},
    setPanelOpen: () => {},
    replayVisit,
    reload: () => {},
  } as StoreClient
}

describe('DetailPane replay', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMediaQueries()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('guards a double-replay and shows an in-flight state until the cooldown ends', async () => {
    const replayVisit = vi.fn()
    const ctx = createDevToolsContext(fakeClient(replayVisit))
    ctx.selectRequest(1)
    const { container } = render(DetailPane, { ctx } as never)
    const btn = () => container.querySelector('button[title="Replay this visit"]') as HTMLButtonElement

    expect(btn().disabled).toBe(false)

    await fireEvent.click(btn())
    expect(replayVisit).toHaveBeenCalledTimes(1)
    // Now disabled and showing progress — the affordance the button lacked.
    expect(btn().disabled).toBe(true)
    expect(btn().textContent).toContain('Replaying')

    // A rapid second click must not re-fire the visit.
    await fireEvent.click(btn())
    expect(replayVisit).toHaveBeenCalledTimes(1)

    // After the cooldown it re-enables and can replay again.
    vi.advanceTimersByTime(1500)
    await tick()
    expect(btn().disabled).toBe(false)
    expect(btn().textContent).toContain('Replay')

    await fireEvent.click(btn())
    expect(replayVisit).toHaveBeenCalledTimes(2)
  })
})
