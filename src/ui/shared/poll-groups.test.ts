import { describe, it, expect } from 'vitest'
import { groupPollEntries, pollGroupExpanded, type PollGroup } from './poll-groups'
import type { RequestRecord, VisitType } from '../../core/types'

let nextId = 1
function makeReq(type: VisitType, url = '/poll'): RequestRecord {
  return {
    visitId: nextId++,
    type,
    method: 'GET',
    url,
    startedAt: nextId * 10,
    events: [],
    features: [],
    diagnostics: [],
    cancelled: false,
    interrupted: false,
    completed: true,
  }
}

describe('groupPollEntries', () => {
  it('collapses consecutive same-URL polls into one group', () => {
    const reqs = [makeReq('full', '/'), makeReq('poll'), makeReq('poll'), makeReq('poll')]
    const entries = groupPollEntries(reqs)
    expect(entries).toHaveLength(2)
    expect(entries[1]).toMatchObject({ kind: 'poll-group' })
    expect((entries[1] as PollGroup).reqs).toHaveLength(3)
  })

  it('keeps a lone poll as a single row', () => {
    const entries = groupPollEntries([makeReq('poll')])
    expect(entries[0].kind).toBe('single')
  })

  it('breaks the group when a non-poll interleaves', () => {
    const entries = groupPollEntries([makeReq('poll'), makeReq('poll'), makeReq('full', '/'), makeReq('poll')])
    expect(entries.map((e) => e.kind)).toEqual(['poll-group', 'single', 'single'])
  })

  it('starts a new group when the poll URL changes', () => {
    const entries = groupPollEntries([
      makeReq('poll', '/a'),
      makeReq('poll', '/a'),
      makeReq('poll', '/b'),
      makeReq('poll', '/b'),
    ])
    expect(entries.map((e) => e.kind)).toEqual(['poll-group', 'poll-group'])
    expect((entries[0] as PollGroup).reqs[0].url).toBe('/a')
    expect((entries[1] as PollGroup).reqs[0].url).toBe('/b')
  })

  it('keys the group by its first record so growth keeps the key stable', () => {
    const first = makeReq('poll')
    const entries1 = groupPollEntries([first, makeReq('poll')])
    const entries2 = groupPollEntries([first, makeReq('poll'), makeReq('poll')])
    expect((entries1[0] as PollGroup).key).toBe((entries2[0] as PollGroup).key)
  })
})

describe('pollGroupExpanded', () => {
  it('expands via the toggle set', () => {
    const group = groupPollEntries([makeReq('poll'), makeReq('poll')])[0] as PollGroup
    expect(pollGroupExpanded(group, new Set([group.key]), null)).toBe(true)
    expect(pollGroupExpanded(group, new Set(), null)).toBe(false)
  })

  it('selection inside the group forces expansion regardless of the toggle', () => {
    const a = makeReq('poll')
    const b = makeReq('poll')
    const group = groupPollEntries([a, b])[0] as PollGroup
    expect(pollGroupExpanded(group, new Set(), b.visitId)).toBe(true)
  })
})
