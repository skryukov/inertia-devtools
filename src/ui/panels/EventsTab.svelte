<script lang="ts">
  import type { RequestRecord, CapturedEvent } from '../../core/types'
  import { eventCategory, eventColor, type EventCategory } from '../shared/event-meta'
  import TreeView from '../shared/TreeView.svelte'

  let { request }: { request: RequestRecord } = $props()

  // --- Lifecycle visualization ---

  interface LifecycleStep {
    name: string
    time: string // relative to first event
    color: string
    terminal?: 'success' | 'error' | 'cancelled'
  }

  const lifecycle = $derived.by((): LifecycleStep[] => {
    if (request.events.length === 0) return []

    const first = request.events[0].timestamp
    const steps: LifecycleStep[] = []

    // Ordered lifecycle events we want to show
    const lifecycleNames = new Set([
      'inertia:before',
      'inertia:start',
      'inertia:success',
      'inertia:error',
      'inertia:httpException',
      'inertia:networkError',
      'inertia:navigate',
      'inertia:finish',
    ])

    for (const event of request.events) {
      if (!lifecycleNames.has(event.name)) continue
      const short = event.name.replace('inertia:', '')
      const offset = Math.round(event.timestamp - first)
      steps.push({
        name: short,
        time: `${offset}ms`,
        color: eventColor(event.name),
        terminal:
          short === 'success'
            ? 'success'
            : short === 'error' || short === 'httpException' || short === 'networkError'
              ? 'error'
              : undefined,
      })
    }

    // If cancelled/interrupted but no error event, add a synthetic terminal step
    if (request.cancelled && !steps.some((s) => s.name === 'error')) {
      const last = request.events[request.events.length - 1]
      const offset = last ? Math.round(last.timestamp - first) : 0
      steps.push({
        name: 'cancelled',
        time: `${offset}ms`,
        color: 'var(--dt-amber)',
        terminal: 'cancelled',
      })
    }

    return steps
  })

  const lifecycleSummary = $derived.by((): string => {
    const parts: string[] = []
    if (request.finishedAt && request.startedAt) {
      const ms = Math.round(request.finishedAt - request.startedAt)
      if (ms > 0) parts.push(ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
    }
    // failed is checked before completed on purpose: an HTTP error is BOTH
    // (finish runs in .finally), and reporting a request that never reached the
    // server as "completed" is the same lie as the green dot.
    if (request.prevented) parts.push('prevented')
    else if (request.interrupted) parts.push('interrupted')
    else if (request.cancelled) parts.push('cancelled')
    else if (request.failed) parts.push('failed')
    else if (request.completed) parts.push('completed')
    else parts.push('in progress')
    return parts.join(' · ')
  })

  // --- Visit data from before event ---

  const visitDetail = $derived.by((): Record<string, unknown> | null => {
    const beforeEvent = request.events.find((e) => e.name === 'inertia:before')
    if (!beforeEvent) return null
    const visit = beforeEvent.detail?.visit as Record<string, unknown> | undefined
    if (!visit) return null
    return visit
  })

  const visitData = $derived.by((): Record<string, unknown> | null => {
    if (!visitDetail) return null
    const data = visitDetail.data as Record<string, unknown> | undefined
    if (!data || Object.keys(data).length === 0) return null
    return data
  })

  const visitOptions = $derived.by((): Record<string, unknown> | null => {
    if (!visitDetail) return null
    // Extract interesting options (skip data, url, method which are shown elsewhere)
    const skip = new Set(['data', 'url', 'method', 'href', 'cancelToken', 'signal'])
    const opts: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(visitDetail)) {
      if (skip.has(k)) continue
      // Skip default/empty values to reduce noise
      if (v === false || v === undefined || v === null) continue
      if (Array.isArray(v) && v.length === 0) continue
      if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) continue
      opts[k] = v
    }
    return Object.keys(opts).length > 0 ? opts : null
  })

  // --- Event list (raw details) ---

  let showRawEvents = $state(false)
  let expandedId = $state<number | null>(null)
  /**
   * Identified by the group's FIRST EVENT ID, not its position in the filtered
   * list. An index is only stable while the list is: toggling a filter chip
   * rebuilds `filteredGroups`, and the stored index then pointed at whichever
   * group happened to land in that slot — so an unrelated group silently
   * expanded and the one the user opened silently closed.
   */
  let expandedProgressGroup = $state<number | null>(null)

  let activeFilters = $state(new Set<EventCategory>(['lifecycle', 'navigation', 'outcome', 'other']))

  const categoryLabels: { key: EventCategory; label: string }[] = [
    { key: 'lifecycle', label: 'Lifecycle' },
    { key: 'navigation', label: 'Navigation' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'other', label: 'Other' },
  ]

  function toggleFilter(cat: EventCategory) {
    const next = new Set(activeFilters)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    activeFilters = next
  }

  // Group consecutive progress events
  interface EventGroup {
    type: 'single'
    event: CapturedEvent
  }
  interface ProgressGroup {
    type: 'progress-group'
    events: CapturedEvent[]
  }
  type EventOrGroup = EventGroup | ProgressGroup

  const groupedEvents = $derived.by((): EventOrGroup[] => {
    const groups: EventOrGroup[] = []
    let progressBuffer: CapturedEvent[] = []

    function flushProgress() {
      if (progressBuffer.length === 0) return
      if (progressBuffer.length === 1) {
        groups.push({ type: 'single', event: progressBuffer[0] })
      } else {
        groups.push({ type: 'progress-group', events: [...progressBuffer] })
      }
      progressBuffer = []
    }

    for (const event of request.events) {
      if (event.name.includes('progress')) {
        progressBuffer.push(event)
      } else {
        flushProgress()
        groups.push({ type: 'single', event })
      }
    }
    flushProgress()
    return groups
  })

  const filteredGroups = $derived(
    groupedEvents.filter((g) => {
      if (g.type === 'single') return activeFilters.has(eventCategory(g.event.name))
      return activeFilters.has('other') // progress is in 'other'
    }),
  )

  function eventTime(ts: number): string {
    const first = request.events[0]?.timestamp ?? ts
    const offset = ts - first
    return `+${Math.round(offset)}ms`
  }

  function shortName(name: string): string {
    return name.replace('inertia:', '')
  }

  function detailKeyCount(detail: Record<string, unknown>): number {
    return Object.keys(detail).length
  }

  function toggleExpand(id: number) {
    expandedId = expandedId === id ? null : id
  }

  function toggleProgressGroup(groupKey: number) {
    expandedProgressGroup = expandedProgressGroup === groupKey ? null : groupKey
  }

  function lastProgressPercent(events: CapturedEvent[]): string {
    for (let i = events.length - 1; i >= 0; i--) {
      const pct = events[i].detail?.percentage
      if (pct !== undefined) return `${pct}%`
    }
    return ''
  }
</script>

<div class="events-tab">
  {#if request.events.length === 0}
    <div class="empty">No events captured</div>
  {:else}
    <!-- Lifecycle visualization -->
    {#if lifecycle.length > 0}
      <div class="lifecycle-box">
        <div class="lifecycle-title">Visit Lifecycle</div>
        <div class="lifecycle-flow">
          {#each lifecycle as step, i (i)}
            {#if i > 0}
              <span class="lifecycle-arrow">→</span>
            {/if}
            <span
              class="lifecycle-step"
              class:terminal-success={step.terminal === 'success'}
              class:terminal-error={step.terminal === 'error'}
              class:terminal-cancelled={step.terminal === 'cancelled'}
              style:color={step.color}
            >
              {#if step.terminal === 'error' || step.terminal === 'cancelled'}✗
              {/if}{step.name}
              <span class="lifecycle-time">{step.time}</span>
            </span>
          {/each}
        </div>
        <div class="lifecycle-summary">{lifecycleSummary}</div>
      </div>
    {/if}

    <!-- Visit data (form data for POST/PUT/PATCH) -->
    {#if visitData}
      <div class="visit-data-box">
        <div class="visit-data-title">Form Data</div>
        <TreeView data={visitData} defaultOpen={true} />
      </div>
    {/if}

    <!-- Visit options -->
    {#if visitOptions}
      <div class="visit-data-box">
        <div class="visit-data-title">Visit Options</div>
        <TreeView data={visitOptions} defaultOpen={true} />
      </div>
    {/if}

    <!-- Toggle for raw events -->
    <button class="raw-toggle" onclick={() => (showRawEvents = !showRawEvents)}>
      <span class="toggle-arrow">{showRawEvents ? '\u25BE' : '\u25B8'}</span>
      Raw Events ({request.events.length})
    </button>

    {#if showRawEvents}
      <div class="filter-bar">
        {#each categoryLabels as { key, label } (key)}
          <button
            class="filter-chip"
            class:active={activeFilters.has(key)}
            aria-pressed={activeFilters.has(key)}
            onclick={() => toggleFilter(key)}
          >
            {label}
          </button>
        {/each}
      </div>

      {#snippet eventRow(event: CapturedEvent)}
        {@const expandable = detailKeyCount(event.detail) > 0}
        {@const expanded = expandedId === event.id}
        <button class="event-row" class:expandable class:expanded onclick={() => expandable && toggleExpand(event.id)}>
          {#if expandable}
            <span class="expand-arrow" class:open={expanded}>{expanded ? '\u25BE' : '\u25B8'}</span>
          {:else}
            <span class="expand-spacer"></span>
          {/if}
          <span class="event-time">{eventTime(event.timestamp)}</span>
          <span class="event-dot" style:background={eventColor(event.name)}></span>
          <span class="event-name" style:color={eventColor(event.name)}
            >{shortName(event.name)}{#if event.heuristic}<span
                class="heuristic-marker"
                title="Attributed by heuristic — this event carries no visit id">~</span
              >{/if}</span
          >
          {#if expandable}
            <span class="detail-hint"
              >{detailKeyCount(event.detail)} {detailKeyCount(event.detail) === 1 ? 'key' : 'keys'}</span
            >
          {/if}
        </button>
        {#if expanded}
          <div class="event-detail">
            <TreeView data={event.detail} defaultOpen={true} />
          </div>
        {/if}
      {/snippet}

      <div class="event-list">
        {#each filteredGroups as group (group.type === 'single' ? group.event.id : `pg-${group.events[0].id}`)}
          {#if group.type === 'single'}
            <div class="event-entry">
              {@render eventRow(group.event)}
            </div>
          {:else}
            {@const events = group.events}
            {@const groupKey = group.events[0].id}
            {@const isExpanded = expandedProgressGroup === groupKey}
            <div class="event-entry">
              <button
                class="event-row expandable"
                class:expanded={isExpanded}
                onclick={() => toggleProgressGroup(groupKey)}
              >
                <span class="expand-arrow" class:open={isExpanded}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
                <span class="event-time">{eventTime(events[0].timestamp)}</span>
                <span class="event-dot" style:background={eventColor('inertia:progress')}></span>
                <span class="event-name" style:color={eventColor('inertia:progress')}>
                  progress <span class="progress-count">&times;{events.length}</span>
                  {#if lastProgressPercent(events)}
                    <span class="progress-pct">{lastProgressPercent(events)}</span>
                  {/if}
                </span>
              </button>
              {#if isExpanded}
                <div class="progress-group-detail">
                  {#each events as event (event.id)}
                    <div class="event-entry nested">
                      {@render eventRow(event)}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .events-tab {
    font-size: 12px;
  }

  .empty {
    color: var(--dt-text-muted);
    text-align: center;
    padding: 24px;
  }

  /* Lifecycle visualization */
  .lifecycle-box {
    border: 1px solid var(--dt-border);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }

  .lifecycle-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    margin-bottom: 6px;
  }

  .lifecycle-flow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .lifecycle-arrow {
    color: var(--dt-text-muted);
    font-size: 11px;
    opacity: 0.5;
  }

  .lifecycle-step {
    font-weight: 600;
    font-size: 11px;
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
  }

  .lifecycle-step.terminal-error,
  .lifecycle-step.terminal-cancelled {
    font-weight: 700;
  }

  .lifecycle-time {
    font-size: 9px;
    font-weight: 400;
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }

  .lifecycle-summary {
    font-size: 10px;
    color: var(--dt-text-muted);
  }

  /* Visit data boxes */
  .visit-data-box {
    border: 1px solid var(--dt-border);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }

  .visit-data-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    margin-bottom: 6px;
  }

  /* Raw events toggle */
  .raw-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 6px 4px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--dt-border);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    color: var(--dt-text-muted);
    cursor: pointer;
    text-align: left;
  }

  .raw-toggle:hover {
    color: var(--dt-text);
  }

  .toggle-arrow {
    font-size: 12px;
    width: 12px;
    text-align: center;
  }

  .filter-bar {
    display: flex;
    gap: 4px;
    padding: 8px 0;
    flex-wrap: wrap;
  }

  .filter-chip {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--dt-border);
    background: none;
    color: var(--dt-text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }

  .filter-chip:hover {
    border-color: var(--dt-text-muted);
    color: var(--dt-text);
  }

  .filter-chip.active {
    background: var(--dt-accent);
    border-color: var(--dt-accent);
    color: white;
  }

  .event-list {
    display: flex;
    flex-direction: column;
  }

  .event-entry {
    border-bottom: 1px solid var(--dt-border);
  }

  .event-entry.nested {
    border-bottom: none;
    border-top: 1px solid var(--dt-border);
  }

  .event-entry.nested:first-child {
    border-top: none;
  }

  .event-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px;
    width: 100%;
    background: none;
    border: none;
    font: inherit;
    text-align: left;
    color: inherit;
    border-radius: 3px;
  }

  .event-row.expandable {
    cursor: pointer;
  }

  .event-row.expandable:hover {
    background: var(--dt-hover);
  }

  .event-row.expanded {
    background: var(--dt-hover);
  }

  .expand-arrow {
    font-size: 12px;
    color: var(--dt-text-muted);
    flex-shrink: 0;
    width: 12px;
    text-align: center;
    transition: color 0.15s;
  }

  .event-row.expandable:hover .expand-arrow {
    color: var(--dt-text);
  }

  .expand-spacer {
    width: 12px;
    flex-shrink: 0;
  }

  .event-time {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    color: var(--dt-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    min-width: 48px;
  }

  .event-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .event-name {
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .heuristic-marker {
    color: var(--dt-text-muted);
    opacity: 0.6;
    font-weight: 400;
    margin-left: 1px;
    cursor: help;
  }

  .progress-count {
    font-weight: 400;
    opacity: 0.7;
  }

  .progress-pct {
    font-size: 10px;
    font-weight: 400;
    opacity: 0.6;
    margin-left: 4px;
  }

  .detail-hint {
    font-size: 10px;
    color: var(--dt-text-muted);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .event-row.expandable:hover .detail-hint {
    opacity: 0.8;
  }

  .event-detail {
    padding: 4px 0 8px 24px;
    border-top: 1px solid var(--dt-border);
    margin-left: 12px;
  }

  .progress-group-detail {
    padding-left: 16px;
    border-top: 1px solid var(--dt-border);
  }
</style>
