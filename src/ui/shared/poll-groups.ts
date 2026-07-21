import type { RequestRecord } from '../../core/types'

/**
 * Grouping of consecutive same-URL poll records for the request list
 * (mirrors how the Events tab groups consecutive progress events).
 * Pure so the collapsing behavior is unit-testable outside Svelte.
 */

export interface SingleEntry {
  kind: 'single'
  req: RequestRecord
}

export interface PollGroup {
  kind: 'poll-group'
  /** Stable while the group's first record survives eviction. */
  key: string
  reqs: RequestRecord[]
}

export type ListEntry = SingleEntry | PollGroup

export function groupPollEntries(requests: RequestRecord[]): ListEntry[] {
  const entries: ListEntry[] = []
  let polls: RequestRecord[] = []

  function flushPolls() {
    if (polls.length === 0) return
    if (polls.length === 1) {
      entries.push({ kind: 'single', req: polls[0] })
    } else {
      entries.push({ kind: 'poll-group', key: `poll-${polls[0].visitId}`, reqs: polls })
    }
    polls = []
  }

  for (const req of requests) {
    if (req.type === 'poll' && (polls.length === 0 || polls[0].url === req.url)) {
      polls.push(req)
    } else {
      flushPolls()
      if (req.type === 'poll') polls.push(req)
      else entries.push({ kind: 'single', req })
    }
  }
  flushPolls()
  return entries
}

/** Selection wins over the toggle so keyboard navigation never lands on a hidden row. */
export function pollGroupExpanded(
  group: PollGroup,
  expandedKeys: Set<string>,
  selectedVisitId: number | null,
): boolean {
  return expandedKeys.has(group.key) || group.reqs.some((r) => r.visitId === selectedVisitId)
}
