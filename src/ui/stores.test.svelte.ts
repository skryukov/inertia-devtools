import { describe, it, expect, beforeEach } from 'vitest'
import { flushSync } from 'svelte'
import type { StoreClient } from '../core/client'
import type { DevToolsState, RequestRecord } from '../core/types'
import { createDevToolsContext, loadActiveTab } from './stores.svelte'
import { mediaQuery, resetMediaQueries } from '../test-setup'

/**
 * The first test in this project to drive reactive state.
 *
 * It could not be written before: Svelte 5 compiles runes only in files ending
 * `.svelte.ts`, and vitest's `include` was `src/**\/*.test.ts`, which does not
 * match that. Name it for the compiler and the runner skipped it; name it for
 * the runner and `$state is not defined`. On top of that, `createDevToolsContext`
 * calls `window.matchMedia`, which jsdom does not implement, so it threw before
 * the first assertion either way.
 *
 * That is why `stores.svelte.ts` — 315 lines holding every piece of panel state —
 * sat at 0%. The gap was two lines of config, not discipline.
 */

function record(visitId: number, url = `/page-${visitId}`): RequestRecord {
  return {
    visitId,
    url,
    method: 'get',
    startedAt: visitId,
    events: [],
    diagnostics: [],
  } as unknown as RequestRecord
}

type FakeClient = StoreClient & { emit: () => void; state: DevToolsState; listenerCount: () => number }

function fakeClient(requests: RequestRecord[] = []): FakeClient {
  const listeners = new Set<(s: DevToolsState) => void>()
  const state = { requests, currentPage: null } as unknown as DevToolsState
  return {
    state,
    hello: { docsProvider: 'inertiajs', previousSessionRequests: [], canAct: true, sourceLinks: false },
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    emit() {
      for (const fn of listeners) fn(state)
    },
    listenerCount: () => listeners.size,
    clear: () => {},
    setPanelOpen: () => {},
    replayVisit: () => {},
    reload: () => {},
  } as FakeClient
}

describe('createDevToolsContext', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMediaQueries()
    mediaQuery('(prefers-color-scheme: dark)').setMatches(false)
  })

  it('recomputes state when the store notifies', () => {
    const client = fakeClient([record(1)])
    const ctx = createDevToolsContext(client)
    expect(ctx.state.requests).toHaveLength(1)

    client.state.requests.push(record(2))
    client.emit()
    flushSync()

    expect(ctx.state.requests).toHaveLength(2)
  })

  it('follows the OS theme while set to system, and stops once pinned', () => {
    const ctx = createDevToolsContext(fakeClient())
    expect(ctx.resolvedTheme).toBe('light')

    mediaQuery('(prefers-color-scheme: dark)').setMatches(true)
    flushSync()
    expect(ctx.resolvedTheme).toBe('dark')

    // cycleTheme walks system -> dark -> light; two steps pins it to light.
    ctx.cycleTheme()
    ctx.cycleTheme()
    expect(ctx.theme).toBe('light')
    mediaQuery('(prefers-color-scheme: dark)').setMatches(true)
    flushSync()
    expect(ctx.resolvedTheme).toBe('light')
  })

  it('walks only the rows the list is showing', () => {
    // The bug this pins: arrows used to walk the whole buffer, so with a filter
    // active they selected records that were not rendered and the detail pane
    // jumped to a row the user could not see.
    const client = fakeClient([record(1), record(2), record(3)])
    const ctx = createDevToolsContext(client)
    ctx.setVisibleRequestIds([1, 3])

    ctx.selectNextRequest()
    expect(ctx.selectedVisitId).toBe(1)
    ctx.selectNextRequest()
    expect(ctx.selectedVisitId).toBe(3)
    ctx.selectNextRequest()
    expect(ctx.selectedVisitId).toBe(3)

    ctx.selectPrevRequest()
    expect(ctx.selectedVisitId).toBe(1)
  })

  it('falls back to the full buffer before the list has reported', () => {
    const ctx = createDevToolsContext(fakeClient([record(1), record(2)]))
    ctx.selectNextRequest()
    expect(ctx.selectedVisitId).toBe(1)
  })

  it('toggles selection off when the selected row is picked again', () => {
    const ctx = createDevToolsContext(fakeClient([record(1)]))
    ctx.selectRequest(1)
    expect(ctx.selectedVisitId).toBe(1)
    ctx.selectRequest(1)
    expect(ctx.selectedVisitId).toBeNull()
  })

  it('releases the store subscription and the media listener on destroy', () => {
    const client = fakeClient([record(1)])
    const mql = mediaQuery('(prefers-color-scheme: dark)')
    const ctx = createDevToolsContext(client)

    expect(client.listenerCount()).toBe(1)
    expect(mql.listenerCount()).toBe(1)

    ctx.destroy()

    // Asserted on the listener sets, not on a stale read of `state`: the
    // derived recomputes on read outside a reactive owner, so reading it back
    // would pass even with the subscription still live.
    expect(client.listenerCount()).toBe(0)
    expect(mql.listenerCount()).toBe(0)
  })
})

describe('loadActiveTab (stale tab migration)', () => {
  const KEY = 'inertia-devtools-tab'
  beforeEach(() => localStorage.clear())

  it('maps a stale tab id forward AND persists it, so the migration runs once', () => {
    localStorage.setItem(KEY, 'page')
    expect(loadActiveTab()).toBe('props')
    // The write-back is the fix: the old inline migration reassigned the rune
    // but never touched storage, so 'page' was re-migrated on every load
    // forever. Drop the saveSetting call and this assertion fails.
    expect(localStorage.getItem(KEY)).toBe('props')
  })

  it('migrates the other stale id too', () => {
    localStorage.setItem(KEY, 'raw')
    expect(loadActiveTab()).toBe('props')
    expect(localStorage.getItem(KEY)).toBe('props')
  })

  it('leaves a current tab untouched and writes nothing', () => {
    localStorage.setItem(KEY, 'network')
    expect(loadActiveTab()).toBe('network')
    expect(localStorage.getItem(KEY)).toBe('network')
  })

  it('falls back to props when nothing is stored', () => {
    expect(loadActiveTab()).toBe('props')
  })
})
