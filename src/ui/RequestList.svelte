<script lang="ts">
  import type { DevToolsContext } from './stores.svelte'
  import type { RequestRecord, SessionRequestSummary, Diagnostic } from '../core/types'
  import { isNonEmptyRecord } from './shared/storage'
  import { useResizable } from './shared/resizable.svelte'
  import { groupPollEntries, pollGroupExpanded, type PollGroup } from './shared/poll-groups'

  let { ctx }: { ctx: DevToolsContext } = $props()

  /** Fields shared between RequestRecord and SessionRequestSummary */
  type RequestLike = RequestRecord | SessionRequestSummary

  function statusColor(req: RequestLike): string {
    // First branch, before the in-flight check: a network-failed visit still
    // has finishedAt set (finish() runs in a .finally()) but no status, so
    // without this it fell all the way through to green — the exact request the
    // developer opened the tool to see, painted as the healthy case.
    if (req.failed) return 'var(--dt-red)'
    if (!req.finishedAt) return 'var(--dt-accent)'
    if ((req.status ?? 0) >= 400) return 'var(--dt-red)'
    if (req.cancelled || req.interrupted || req.prevented) return 'var(--dt-text-muted)'
    if (req.type === 'client') return 'var(--dt-emerald)'
    if (req.type === 'prefetch') return 'var(--dt-cyan)'
    if (req.type === 'redirect') return 'var(--dt-amber)'
    if ((req.status ?? 0) >= 300) return 'var(--dt-amber)'
    return 'var(--dt-green)'
  }

  function methodLabel(req: RequestLike): string {
    return req.method ?? 'GET'
  }

  function urlPath(url: string): string {
    try {
      const u = new URL(url, 'http://localhost')
      return u.pathname + u.search
    } catch {
      return url
    }
  }

  function displayLabel(req: RequestLike): string {
    // For deferred requests with only, show group names instead of URL path
    if (req.type === 'deferred' && req.only?.length) {
      return req.only.join(', ')
    }
    if (!req.url) return '/'
    return urlPath(req.url)
  }

  function redirectTarget(req: RequestRecord): string | null {
    if (req.type === 'client') return null
    if (!req.completed || !req.page?.url) return null
    if (req.method?.toUpperCase() === 'GET') return null
    return `GET ${urlPath(req.page.url)}`
  }

  function typeIcon(req: RequestLike): string {
    const featureTypes = 'featureTypes' in req ? req.featureTypes : req.features.map((f) => f.type)
    if (featureTypes.includes('cached')) return 'C'
    switch (req.type) {
      case 'prefetch':
        return 'P'
      case 'deferred':
        return 'D'
      case 'partial':
        return featureTypes.includes('scroll') ? 'S' : '~'
      case 'redirect':
        return 'R'
      case 'client':
        return '\u2022' // bullet dot
      case 'poll':
        return '\u21bb' // clockwise arrow
      default:
        return ''
    }
  }

  function hasErrors(req: RequestRecord): boolean {
    return isNonEmptyRecord(req.page?.props?.errors)
  }

  function wallTime(req: RequestLike): string {
    // Use finishedAt for synthetic initial record (startedAt === 0)
    const t = req.startedAt || req.finishedAt
    if (!t) return ''
    const epoch = performance.timeOrigin + t
    const d = new Date(epoch)
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    const s = d.getSeconds().toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  function duration(req: RequestLike): string {
    // Initial page load (synthetic record): show "initial" instead of "0ms"
    if (req.initial) return 'initial'
    // Client-side visits are instant — show "client" instead of "0ms"
    if (req.type === 'client') return 'client'
    // Prevented visits never started — there is no duration to show
    if (req.prevented) return ''
    // Don't show duration for in-flight requests — avoids stale/confusing numbers
    if (!req.finishedAt) return ''
    const ms = Math.round(req.finishedAt - req.startedAt)
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  let previousSessionExpanded = $state(false)

  /** Which request types are visible. All on by default; click to toggle off. */
  let hiddenTypes = $state(new Set<string>())

  const list = useResizable({ axis: 'x', storageKey: 'list-width', min: 180, max: 500, initial: 260 })

  /** Map request type to filter category */
  function filterCategory(req: RequestRecord): string {
    const t = req.type
    if (t === 'partial' || t === 'deferred' || t === 'prefetch' || t === 'poll' || t === 'client') return t
    const m = (req.method ?? 'GET').toUpperCase()
    if (m !== 'GET') return 'mutations'
    return 'visits'
  }

  const filteredRequests = $derived.by(() => {
    let reqs = ctx.state.requests

    // Apply type visibility filters
    if (hiddenTypes.size > 0) {
      reqs = reqs.filter((req) => !hiddenTypes.has(filterCategory(req)))
    }

    // Apply text search
    const q = ctx.requestFilter.toLowerCase().trim()
    if (!q) return reqs
    return reqs.filter((req) => {
      const url = req.url?.toLowerCase() ?? ''
      const method = req.method?.toLowerCase() ?? ''
      const component = req.page?.component?.toLowerCase() ?? ''
      const type = req.type?.toLowerCase() ?? ''
      return url.includes(q) || method.includes(q) || component.includes(q) || type.includes(q)
    })
  })

  /** Which filter categories have at least one request */
  const activeCategories = $derived.by(() => {
    const cats = new Set<string>()
    for (const req of ctx.state.requests) cats.add(filterCategory(req))
    return cats
  })

  function toggleCategory(cat: string) {
    const next = new Set(hiddenTypes)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    hiddenTypes = next
  }

  // Group consecutive polls of the same URL (logic in shared/poll-groups.ts)
  const listEntries = $derived(groupPollEntries(filteredRequests))

  // Tell the context what is actually on screen, in display order, so arrow
  // keys walk the visible rows rather than the whole buffer.
  $effect(() => {
    ctx.setVisibleRequestIds(filteredRequests.map((r) => r.visitId))
  })

  /**
   * Keep the selected row in view. Arrow-key selection moved the highlight
   * without scrolling, so browsing a long list silently walked off-screen.
   */
  let listEl = $state<HTMLElement | undefined>()
  $effect(() => {
    const id = ctx.selectedVisitId
    if (id === null || !listEl) return
    listEl.querySelector<HTMLElement>(`[data-visit-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  })

  let expandedPollGroups = $state(new Set<string>())

  function isGroupExpanded(group: PollGroup): boolean {
    return pollGroupExpanded(group, expandedPollGroups, ctx.selectedVisitId)
  }

  function togglePollGroup(key: string) {
    const next = new Set(expandedPollGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedPollGroups = next
  }
</script>

<div class="request-list-wrapper" style:width="{list.size}px">
  <div class="request-list" bind:this={listEl}>
    {#if ctx.state.requests.length > 0}
      <div class="filter-bar">
        {#if activeCategories.size > 1}
          <div class="filter-chips">
            {#each ['visits', 'mutations', 'partial', 'deferred', 'prefetch', 'poll', 'client'] as cat (cat)}
              {#if activeCategories.has(cat)}
                <button
                  class="filter-chip"
                  class:hidden-chip={hiddenTypes.has(cat)}
                  onclick={() => toggleCategory(cat)}
                  title={hiddenTypes.has(cat) ? `Show ${cat}` : `Hide ${cat}`}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
        <input
          type="text"
          class="search-input"
          placeholder="Filter..."
          aria-label="Filter requests"
          value={ctx.requestFilter}
          oninput={(e) => ctx.setRequestFilter(e.currentTarget.value)}
        />
      </div>
    {/if}
    {#if ctx.state.requests.length === 0}
      {#if ctx.showInertiaNotDetected}
        <div class="not-detected">
          <div class="not-detected-title">Inertia not detected</div>
          <p>The devtools will activate when you navigate to a page rendered by Inertia.</p>
          <p>If you expected Inertia here, check that:</p>
          <ul>
            <li>Your server returns Inertia responses</li>
            <li>The Inertia client adapter is installed</li>
          </ul>
        </div>
      {:else}
        <div class="empty">No requests yet</div>
      {/if}
    {:else if filteredRequests.length === 0}
      <div class="empty">No matching requests</div>
    {:else}
      {#if ctx.previousSessionRequests.length > 0}
        <button class="session-label" onclick={() => (previousSessionExpanded = !previousSessionExpanded)}>
          <span class="session-arrow">{previousSessionExpanded ? '\u25BE' : '\u25B8'}</span>
          Previous session ({ctx.previousSessionRequests.length})
        </button>
        {#if previousSessionExpanded}
          {#each ctx.previousSessionRequests as req (req.visitId)}
            {@const icon = typeIcon(req)}
            <div class="request-item previous" class:deferred={req.parentVisitId != null}>
              <div class="request-row">
                <span class="status-dot" style:background={statusColor(req)}></span>
                <span class="time">{wallTime(req)}</span>
                <span class="method">{methodLabel(req)}</span>
                <span class="url" title={req.url}>
                  {displayLabel(req)}
                </span>
                {#if icon}
                  <span class="type-badge">{icon}</span>
                {/if}
                {#if req.hasErrors}
                  <span class="error-dot" title="Has validation errors"></span>
                {/if}
                <span class="duration">{duration(req)}</span>
              </div>
              {#if req.diagnostics?.length}
                <div class="diagnostic-line">
                  {#each req.diagnostics as diag (diag.id)}
                    <span class="diagnostic {diag.severity}">
                      {diag.severity === 'error' ? '✗' : diag.severity === 'warning' ? '⚠' : 'ℹ'}
                      {diag.message}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
        <div class="session-divider"></div>
      {/if}
      {#snippet requestRow(req: RequestRecord, nested: boolean = false)}
        {@const icon = typeIcon(req)}
        {@const redirect = redirectTarget(req)}
        <button
          class="request-item"
          class:selected={ctx.selectedVisitId === req.visitId}
          class:in-flight={!req.finishedAt}
          class:deferred={req.parentVisitId != null}
          class:nested
          aria-current={ctx.selectedVisitId === req.visitId ? 'true' : undefined}
          data-visit-id={req.visitId}
          onclick={() => ctx.selectRequest(req.visitId)}
        >
          <div class="request-row">
            <span class="status-dot" style:background={statusColor(req)}></span>
            <span class="time">{wallTime(req)}</span>
            <span class="method">{methodLabel(req)}</span>
            <span class="url" title={req.url}>
              {displayLabel(req)}{#if redirect}<span class="redirect-arrow"> → {redirect}</span>{/if}
            </span>
            {#if icon}
              <span class="type-badge">{icon}</span>
            {/if}
            {#if hasErrors(req)}
              <span class="error-dot" title="Has validation errors"></span>
            {/if}
            <span class="duration">{duration(req)}</span>
          </div>
          {#if req.diagnostics?.length}
            <div class="diagnostic-line">
              {#each req.diagnostics as diag (diag.id)}
                <span class="diagnostic {diag.severity}">
                  {diag.severity === 'error' ? '✗' : diag.severity === 'warning' ? '⚠' : 'ℹ'}
                  {diag.message}
                </span>
              {/each}
            </div>
          {/if}
        </button>
      {/snippet}
      {#each listEntries as entry (entry.kind === 'single' ? entry.req.visitId : entry.key)}
        {#if entry.kind === 'single'}
          {@render requestRow(entry.req)}
        {:else}
          {@const latest = entry.reqs[entry.reqs.length - 1]}
          {@const expanded = isGroupExpanded(entry)}
          <button class="request-item poll-group" onclick={() => togglePollGroup(entry.key)}>
            <div class="request-row">
              <span class="group-arrow">{expanded ? '▾' : '▸'}</span>
              <span class="status-dot" style:background={statusColor(latest)}></span>
              <span class="time">{wallTime(latest)}</span>
              <span class="method">{methodLabel(latest)}</span>
              <span class="url" title={latest.url}>{displayLabel(latest)}</span>
              <span class="type-badge">↻ ×{entry.reqs.length}</span>
              <span class="duration">{duration(latest)}</span>
            </div>
          </button>
          {#if expanded}
            {#each entry.reqs as req (req.visitId)}
              {@render requestRow(req, true)}
            {/each}
          {/if}
        {/if}
      {/each}
    {/if}
  </div>
  <div
    class="resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize request list"
    onpointerdown={list.onResizeStart}
  >
    <div class="resize-grip"></div>
  </div>
</div>

<style>
  .request-list-wrapper {
    min-width: 180px;
    max-width: 500px;
    border-right: 1px solid var(--dt-border);
    flex-shrink: 0;
    position: relative;
    display: flex;
  }

  .request-list {
    flex: 1;
    min-width: 0;
    overflow: clip auto;
    overscroll-behavior: contain;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
    z-index: 1;
  }

  .resize-grip {
    width: 3px;
    height: 32px;
    border-radius: 2px;
    background: var(--dt-border);
    transition: background 0.15s;
  }

  .resize-handle:hover .resize-grip {
    background: var(--dt-text-muted);
  }

  .filter-bar {
    padding: 6px 8px;
    border-bottom: 1px solid var(--dt-border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .filter-chip {
    font-size: 10px;
    font-family: inherit;
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid var(--dt-border);
    background: none;
    color: var(--dt-text-muted);
    cursor: pointer;
    transition: all 0.1s;
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .filter-chip:hover {
    border-color: var(--dt-text-muted);
    color: var(--dt-text);
  }

  .filter-chip.hidden-chip {
    opacity: 0.4;
    text-decoration: line-through;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 8px;
    font-size: 11px;
    font-family: inherit;
    border: 1px solid var(--dt-border);
    border-radius: 4px;
    background: var(--dt-bg);
    color: var(--dt-text);
    outline: none;
  }

  .search-input::placeholder {
    color: var(--dt-text-muted);
  }

  .search-input:focus {
    border-color: var(--dt-accent);
  }

  .empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--dt-text-muted);
    font-size: 12px;
  }

  .not-detected {
    padding: 16px;
    font-size: 12px;
    color: var(--dt-text-muted);
    animation: fade-in 0.3s ease-in;
  }

  .not-detected-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--dt-text);
    margin-bottom: 8px;
  }

  .not-detected p {
    margin: 4px 0;
    line-height: 1.5;
  }

  .not-detected ul {
    margin: 4px 0 0;
    padding-left: 18px;
  }

  .not-detected li {
    margin: 2px 0;
    line-height: 1.5;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .request-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 6px 10px;
    cursor: pointer;
    transition: background 0.1s;
    font-size: 12px;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--dt-border);
    font: inherit;
    color: inherit;
    text-align: left;
  }

  .request-item:hover {
    background: var(--dt-hover);
  }

  .request-item.selected {
    background: oklch(from var(--dt-accent) l c h / 0.1);
    border-left: 2px solid var(--dt-accent);
    padding-left: 8px;
  }

  .request-item.in-flight {
    opacity: 0.7;
  }

  .request-item.deferred,
  .request-item.nested {
    padding-left: 24px;
  }

  .request-item.deferred.selected,
  .request-item.nested.selected {
    padding-left: 22px;
  }

  .group-arrow {
    font-size: 11px;
    width: 10px;
    text-align: center;
    color: var(--dt-text-muted);
    flex-shrink: 0;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .time {
    font-size: 9px;
    color: var(--dt-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }

  .method {
    font-weight: 600;
    color: var(--dt-text-muted);
    font-size: 10px;
    flex-shrink: 0;
  }

  .url {
    color: var(--dt-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .redirect-arrow {
    color: var(--dt-text-muted);
  }

  .type-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--dt-border);
    color: var(--dt-text-muted);
    flex-shrink: 0;
  }

  .error-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--dt-red);
    flex-shrink: 0;
  }

  .duration {
    font-size: 10px;
    color: var(--dt-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .session-label {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    background: none;
    border: none;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .session-label:hover {
    color: var(--dt-text);
  }

  .session-arrow {
    font-size: 11px;
    width: 10px;
    text-align: center;
  }

  .request-item.previous {
    opacity: 0.5;
    cursor: default;
  }

  .request-item.previous:hover {
    background: none;
  }

  .session-divider {
    height: 1px;
    background: var(--dt-border);
    margin: 4px 10px;
  }

  .request-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .diagnostic-line {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0 2px 12px;
  }

  .diagnostic {
    font-size: 10px;
    line-height: 1.3;
  }

  .diagnostic.warning {
    color: var(--dt-amber);
  }

  .diagnostic.error {
    color: var(--dt-red);
  }

  .diagnostic.info {
    color: var(--dt-text-muted);
  }
</style>
