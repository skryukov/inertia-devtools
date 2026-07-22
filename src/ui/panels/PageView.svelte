<script lang="ts">
  import type { InertiaPage } from '../../core/protocol'
  import type { ActiveFeature, VisitType, DocsProvider, RequestRecord } from '../../core/types'
  import { diffProps, countTopLevelChanges } from '../../core/diff'
  import { diffToMarkdown } from '../../core/markdown'
  import { redactExport } from '../../core/redact'
  import { featureColor } from '../shared/feature-colors'
  import { getFeatureInfo } from '../shared/feature-info'
  import { copyToClipboard } from '../shared/clipboard'
  import { isNonEmptyRecord } from '../shared/storage'
  import { jsonByteSize, formatBytes, displayValue } from '../shared/format'
  import { searchPaths } from '../shared/tree-search'
  import { ICON_COPY } from '../shared/icons'
  import TreeView from '../shared/TreeView.svelte'
  import DiffTreeView from '../shared/DiffTreeView.svelte'

  interface Props {
    page: InertiaPage | null
    previousPage?: InertiaPage
    features: ActiveFeature[]
    only?: string[]
    except?: string[]
    type?: VisitType
    isLive?: boolean
    componentName?: string
    showRaw?: boolean
    visitId?: number
    docsProvider?: DocsProvider
    /** Selected request record — enables the "Copy diff" affordance. */
    request?: RequestRecord
    /** Called after a copy action so the parent can show its toast. */
    onCopied?: () => void
  }

  let {
    page = null,
    previousPage,
    features = [],
    only,
    except,
    type,
    isLive = false,
    componentName,
    showRaw: externalShowRaw,
    visitId,
    docsProvider,
    request,
    onCopied,
  }: Props = $props()

  // Live view controls its own toggle; selected request gets it from parent
  let liveShowRaw = $state(false)
  const showRaw = $derived(isLive ? liveShowRaw : (externalShowRaw ?? false))

  // --- Errors ---
  const errors = $derived.by((): Record<string, unknown> | null => {
    const e = page?.props?.errors
    return isNonEmptyRecord(e) ? e : null
  })

  const errorCount = $derived(errors ? Object.keys(errors).length : 0)

  // --- Flash ---
  const flash = $derived.by((): Record<string, unknown> | null => {
    const f = page?.flash
    return isNonEmptyRecord(f) ? f : null
  })

  // --- Features ---
  let expandedFeature = $state<string | null>(null)

  function toggleFeature(featureType: string) {
    expandedFeature = expandedFeature === featureType ? null : featureType
  }

  // --- Metadata ---
  const isDeferred = $derived(type === 'deferred')
  const deferredGroups = $derived(isDeferred && only?.length ? only : null)
  const onlyProps = $derived(!isDeferred && only?.length ? only : null)
  const exceptProps = $derived(except?.length ? except : null)
  const isRedirect = $derived(type === 'redirect')

  // --- Props ---
  const pageProps: Record<string, unknown> = $derived(page?.props ?? {})
  const propCount = $derived(Object.keys(pageProps).length)
  const hasProps = $derived(propCount > 0)
  const hasInternalKeys = $derived(Object.keys(pageProps).some((k) => k.startsWith('_')))

  let showInternal = $state(false)
  let showSizes = $state(false)

  /** Per-key sizes, sorted largest first */
  const propSizes = $derived.by(() => {
    if (!showSizes || !hasProps) return []
    return Object.entries(pageProps)
      .filter(([k]) => showInternal || !k.startsWith('_'))
      .map(([k, v]) => ({ key: k, size: jsonByteSize(v) }))
      .toSorted((a, b) => b.size - a.size)
  })

  const totalPropsSize = $derived(hasProps ? jsonByteSize(pageProps) : 0)

  const filteredProps = $derived.by(() => {
    if (showInternal) return pageProps
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(pageProps)) {
      if (!k.startsWith('_')) result[k] = v
    }
    return result
  })

  // --- Props search ---
  let searchInput = $state('')
  let propsQuery = $state('')
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  function handleSearchInput(value: string) {
    searchInput = value
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => (propsQuery = value), 150)
  }

  $effect(() => {
    return () => clearTimeout(searchTimer)
  })

  const searchActive = $derived(propsQuery.trim().length > 0)
  // Lazy — only evaluated where the props tree renders (Preview mode, non-diff)
  const searchResult = $derived.by(() => (searchActive ? searchPaths(filteredProps, propsQuery) : null))
  const matchCount = $derived(searchResult?.matches.size ?? 0)

  // --- Diff ---
  const prevProps = $derived(previousPage?.props)
  const hasPrevious = $derived(prevProps !== undefined)
  let showDiff = $state(false)
  let showUnchanged = $state(false)
  // Recomputes once per prop-tree change, not per render: $derived memoizes on
  // its dependencies. The count is shown in the Diff button's badge, so it has
  // to be computed whether or not the Diff view is open.
  const changeCount = $derived(
    hasPrevious ? countTopLevelChanges(prevProps as Record<string, unknown>, pageProps as Record<string, unknown>) : 0,
  )
  const diffNodes = $derived(
    showDiff && hasPrevious
      ? diffProps(prevProps as Record<string, unknown>, pageProps as Record<string, unknown>)
      : [],
  )

  // Reset UI state when the selected request changes
  const identity = $derived(visitId ?? (page ? `${page.url}::${page.component}` : ''))
  $effect(() => {
    void identity
    showDiff = !isLive && isDeferred
    expandedFeature = null
  })

  // --- Copy actions ---
  async function handleCopyRaw() {
    // Bypasses markdown.ts, so it needs the export redaction of its own —
    // this button puts props straight on the clipboard.
    if (await copyToClipboard(JSON.stringify(redactExport(page), null, 2))) onCopied?.()
  }

  async function handleCopyDiff() {
    if (!request) return
    if (await copyToClipboard(diffToMarkdown(request))) onCopied?.()
  }
</script>

{#snippet liveHeader()}
  <div class="live-header">
    <span class="live-dot"></span>
    <span class="live-label">Live</span>
    <span class="live-separator"></span>
    <span class="live-component">{componentName ?? page?.component}</span>
    {#if errorCount > 0}
      <span class="live-error-badge">{errorCount} {errorCount === 1 ? 'error' : 'errors'}</span>
    {/if}
    <div class="mode-toggle">
      <button
        class="toggle-btn"
        class:active={!liveShowRaw}
        aria-pressed={!liveShowRaw}
        onclick={() => (liveShowRaw = false)}>Preview</button
      >
      <button
        class="toggle-btn"
        class:active={liveShowRaw}
        aria-pressed={liveShowRaw}
        onclick={() => (liveShowRaw = true)}>Raw</button
      >
    </div>
  </div>
{/snippet}

<div class="page-view">
  {#if !page}
    {#if type === 'prefetch'}
      <div class="empty">Prefetch — response cached for later use</div>
    {:else if type === 'redirect'}
      <div class="empty">Redirect — no Inertia page object received</div>
    {:else}
      <div class="empty">Waiting for Inertia page...</div>
    {/if}
  {:else if showRaw}
    <!-- Raw mode -->
    {#if isLive}{@render liveHeader()}{/if}

    <div class="raw-section">
      <div class="raw-controls">
        <span class="raw-label">Page Object</span>
        <button class="copy-btn" onclick={handleCopyRaw} title="Copy JSON">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round">{@html ICON_COPY}</svg
          >
          Copy
        </button>
      </div>
      {#if page}
        <TreeView data={page} defaultOpen={true} />
      {:else if type === 'redirect'}
        <div class="empty">Redirect — no Inertia page object received</div>
      {:else}
        <div class="empty">No page object</div>
      {/if}
    </div>
  {:else}
    <!-- Preview mode -->

    {#if isLive}{@render liveHeader()}{/if}

    <!-- Prefetch / Redirect notices -->
    {#if type === 'prefetch' && !hasProps}
      <div class="empty prefetch-notice">
        <div class="prefetch-label">Prefetch</div>
        <p>Response is cached internally by Inertia — props appear when the user navigates to this page.</p>
      </div>
    {:else if isRedirect}
      <div class="empty redirect-notice">
        <div class="redirect-label">Redirect</div>
        <p>Server responded with a redirect — page reloaded via full navigation.</p>
        <p class="redirect-hint">Props are available on the subsequent page load.</p>
      </div>
    {:else}
      <!-- URL row (live only) -->
      {#if isLive}
        <div class="section">
          <div class="info-row">
            <span class="info-label">URL</span>
            <span class="info-value">{page.url}</span>
          </div>
        </div>
      {/if}

      <!-- Errors -->
      {#if errors}
        <details class="section" open>
          <summary class="section-title">
            Errors <span class="count-badge error-count">{errorCount}</span>
          </summary>
          <div class="kv-list error-list">
            {#each Object.entries(errors) as [key, value] (key)}
              <div class="kv-row">
                <span class="kv-key">{key}</span>
                <!-- Adapters put arrays (or nested bags) here as often as
                     strings; interpolating raw rendered "a,b" or the useless
                     "[object Object]". The markdown export was fixed for this
                     and the panel was not. -->
                <span class="kv-value error-value">{displayValue(value)}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}

      <!-- Flash -->
      {#if flash}
        <details class="section" open>
          <summary class="section-title">
            Flash <span class="count-badge">{Object.keys(flash).length}</span>
          </summary>
          <div class="kv-list">
            {#each Object.entries(flash) as [key, value] (key)}
              <div class="kv-row">
                <span class="kv-key">{key}</span>
                <span class="kv-value">{displayValue(value)}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}

      <!-- Feature badges -->
      {#if features.length > 0}
        <div class="section">
          <h4 class="section-heading">Features</h4>
          <div class="feature-badges">
            {#each features as feature (feature.type)}
              <button
                class="feature-badge"
                class:expanded={expandedFeature === feature.type}
                style:--badge-color={featureColor(feature.type)}
                onclick={() => toggleFeature(feature.type)}
              >
                {feature.type}
              </button>
            {/each}
          </div>
          {#if expandedFeature}
            {@const active = features.find((f) => f.type === expandedFeature)}
            {@const info = getFeatureInfo(expandedFeature, docsProvider)}
            {#if active}
              <div class="feature-expansion">
                {#if info}
                  <div class="feature-info">
                    <span>{info.description}</span>
                    <a class="docs-link" href={info.docsUrl} target="_blank" rel="noopener">Docs &rarr;</a>
                  </div>
                {/if}
                {#if active.details && Object.keys(active.details).length > 0}
                  <div class="feature-data">
                    <TreeView data={active.details} defaultOpen={true} />
                  </div>
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- Metadata bars -->
      {#if deferredGroups}
        <div class="props-meta">Deferred group: <strong>{deferredGroups.join(', ')}</strong></div>
      {/if}
      {#if onlyProps}
        <div class="props-meta">Only: <strong>{onlyProps.join(', ')}</strong></div>
      {/if}
      {#if exceptProps}
        <div class="props-meta">Except: <strong>{exceptProps.join(', ')}</strong></div>
      {/if}

      <!-- Props -->
      {#if hasProps || hasPrevious}
        <div class="props-controls">
          <div class="toggle-group">
            <button
              class="toggle-btn"
              class:active={!showDiff}
              aria-pressed={!showDiff}
              onclick={() => (showDiff = false)}
            >
              Current
            </button>
            <button
              class="toggle-btn"
              class:active={showDiff}
              aria-pressed={showDiff}
              onclick={() => (showDiff = true)}
              title={hasPrevious ? `${changeCount} changes from previous` : 'No previous page to diff against'}
            >
              Diff{#if hasPrevious && changeCount > 0}<span class="change-count">{changeCount}</span>{/if}
            </button>
          </div>
          <div class="controls-right">
            {#if showDiff && hasPrevious}
              <label class="control-toggle">
                <input type="checkbox" bind:checked={showUnchanged} />
                Show unchanged
              </label>
            {/if}
            <label class="control-toggle">
              <input type="checkbox" bind:checked={showSizes} />
              Sizes
            </label>
            {#if hasInternalKeys}
              <label class="control-toggle">
                <input type="checkbox" bind:checked={showInternal} />
                Show internal
              </label>
            {/if}
            {#if showDiff && hasPrevious && request}
              <button class="copy-btn" onclick={handleCopyDiff} title="Copy diff as Markdown">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round">{@html ICON_COPY}</svg
                >
                Copy
              </button>
            {/if}
          </div>
        </div>

        {#if showSizes && propSizes.length > 0}
          <div class="size-breakdown">
            <div class="size-total">Total: <strong>{formatBytes(totalPropsSize)}</strong></div>
            {#each propSizes as { key, size } (key)}
              {@const pct = totalPropsSize > 0 ? (size / totalPropsSize) * 100 : 0}
              <div class="size-row">
                <span class="size-key">{key}</span>
                <div class="size-bar-track">
                  <div class="size-bar-fill" style:transform="scaleX({pct / 100})"></div>
                </div>
                <span class="size-value">{formatBytes(size)}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if showDiff}
          {#if !hasPrevious}
            <div class="empty no-previous">No previous page to diff against.</div>
          {:else if diffNodes.length === 0}
            <div class="empty">No differences</div>
          {:else}
            <DiffTreeView nodes={diffNodes} {showUnchanged} />
          {/if}
        {:else if hasProps}
          <div class="props-search">
            <input
              type="text"
              class="search-input"
              placeholder="Search props..."
              aria-label="Search props"
              value={searchInput}
              oninput={(e) => handleSearchInput(e.currentTarget.value)}
            />
            {#if searchActive}
              <span class="search-count" class:zero={matchCount === 0}>
                {matchCount === 0 ? 'no matches' : `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`}
              </span>
            {/if}
          </div>
          <TreeView
            data={filteredProps}
            defaultOpen={true}
            searchMatches={searchResult?.matches}
            forceExpand={searchResult?.expand}
          />
        {:else}
          <div class="empty">No props</div>
        {/if}
      {:else}
        <div class="empty">No props</div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .page-view {
    font-size: 12px;
  }

  .empty {
    color: var(--dt-text-muted);
    text-align: center;
    padding: 24px;
  }

  /* --- Live header --- */
  .live-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-bottom: 8px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--dt-border);
  }

  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--dt-green);
    flex-shrink: 0;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .live-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
  }

  .live-separator {
    width: 1px;
    height: 12px;
    background: var(--dt-border);
  }

  .live-component {
    font-size: 13px;
    font-weight: 600;
    color: var(--dt-accent);
  }

  .live-error-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--dt-red);
    color: oklch(1 0 0);
    font-weight: 600;
  }

  .mode-toggle {
    margin-left: auto;
    display: flex;
    border-radius: 4px;
    border: 1px solid var(--dt-border);
    overflow: hidden;
  }

  /* --- Sections --- */
  .section {
    padding: 8px 0;
    border-bottom: 1px solid var(--dt-border);
  }

  .section:last-child {
    border-bottom: none;
  }

  .section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    margin: 0 0 6px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    user-select: none;
  }

  .section-title::-webkit-details-marker {
    display: none;
  }

  .section-title::before {
    content: '\25B6';
    font-size: 8px;
    transition: transform 0.15s;
  }

  details[open] > .section-title::before {
    transform: rotate(90deg);
  }

  /* Clickable disclosure — give the mouse the same feedback the other
     controls have (it had none). */
  .section-title:hover {
    color: var(--dt-text);
  }

  .section-heading {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    margin: 0 0 6px;
    font-weight: 500;
  }

  /* --- Info row --- */
  .info-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
  }

  .info-label {
    color: var(--dt-text-muted);
    width: 72px;
    flex-shrink: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .info-value {
    color: var(--dt-text);
    word-break: break-all;
  }

  /* --- Count badges --- */
  .count-badge {
    font-size: 10px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--dt-border);
    color: var(--dt-text-muted);
    font-weight: 600;
  }

  .error-count {
    background: var(--dt-red);
    color: oklch(1 0 0);
  }

  /* --- Key-value lists --- */
  .kv-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .kv-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .error-list .kv-row {
    background: oklch(from var(--dt-red) l c h / 0.08);
  }

  .kv-key {
    color: var(--dt-text-muted);
    font-size: 11px;
    flex-shrink: 0;
    font-weight: 500;
  }

  .kv-value {
    color: var(--dt-text);
    word-break: break-all;
  }

  .error-value {
    color: var(--dt-red);
  }

  /* --- Feature badges --- */
  .feature-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  /*
   * Tinted background with the accent as TEXT, not white text on the accent.
   * White on the lighter accents was ~1.9:1 (yellow) to ~2.5:1 — nowhere near
   * AA, and feature badges are a headline feature. The accent already meets
   * contrast against the panel background (that is what the tokens were tuned
   * for), so using it as the foreground inherits a ratio that passes instead
   * of inventing a new pairing that does not.
   */
  .feature-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 3px;
    background: color-mix(in oklch, var(--badge-color) 16%, transparent);
    border: 1px solid color-mix(in oklch, var(--badge-color) 38%, transparent);
    color: var(--badge-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    font-family: inherit;
    cursor: pointer;
  }

  .feature-badge:hover {
    background: color-mix(in oklch, var(--badge-color) 24%, transparent);
  }

  .feature-badge.expanded {
    outline: 1px solid oklch(1 0 0 / 0.3);
    outline-offset: 1px;
  }

  .feature-expansion {
    width: 100%;
    padding-top: 6px;
  }

  .feature-info {
    font-size: 11px;
    color: var(--dt-text-muted);
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .docs-link {
    color: var(--dt-accent);
    text-decoration: none;
    font-size: 10px;
    white-space: nowrap;
  }

  .docs-link:hover {
    text-decoration: underline;
  }

  .feature-data {
    padding: 4px 0 0 4px;
  }

  /* --- Metadata bars --- */
  .props-meta {
    font-size: 11px;
    color: var(--dt-text-muted);
    margin-bottom: 4px;
    padding: 3px 8px;
    background: var(--dt-border);
    border-radius: 4px;
  }

  .props-meta strong {
    color: var(--dt-text);
  }

  .props-meta + .props-controls {
    margin-top: 4px;
  }

  /* --- Props controls --- */
  .props-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    margin-top: 8px;
  }

  .toggle-group {
    display: flex;
    border-radius: 4px;
    border: 1px solid var(--dt-border);
    overflow: hidden;
  }

  .toggle-btn {
    background: none;
    border: none;
    color: var(--dt-text-muted);
    font-size: 11px;
    padding: 3px 10px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .toggle-btn.active {
    background: var(--dt-accent-surface);
    color: white;
  }

  .toggle-btn:not(.active):hover {
    color: var(--dt-text);
  }

  .change-count {
    font-size: 10px;
    background: oklch(var(--dt-overlay) / 0.25);
    padding: 0 5px;
    border-radius: 8px;
    font-weight: 600;
  }

  .controls-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .control-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--dt-text-muted);
    cursor: pointer;
    white-space: nowrap;
  }

  .control-toggle input {
    margin: 0;
    cursor: pointer;
  }

  .no-previous {
    font-style: italic;
  }

  /* --- Props search --- */
  .props-search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .search-input {
    flex: 1;
    min-width: 0;
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

  /* Keyboard focus stays visible; a mouse click does not draw a ring. */
  .search-input:focus-visible {
    outline: 2px solid var(--dt-accent);
    outline-offset: -1px;
    border-color: var(--dt-accent);
  }

  .search-input::placeholder {
    color: var(--dt-text-muted);
  }

  .search-input:focus {
    border-color: var(--dt-accent);
  }

  .search-count {
    font-size: 11px;
    color: var(--dt-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .search-count.zero {
    font-style: italic;
  }

  /* --- Size breakdown --- */
  .size-breakdown {
    padding: 4px 0 8px;
    border-bottom: 1px solid var(--dt-border);
    margin-bottom: 4px;
  }

  .size-total {
    font-size: 11px;
    color: var(--dt-text-muted);
    margin-bottom: 4px;
  }

  .size-total strong {
    color: var(--dt-text);
  }

  .size-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 0;
    font-size: 11px;
  }

  .size-key {
    color: var(--dt-purple);
    width: 100px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
  }

  .size-bar-track {
    flex: 1;
    height: 4px;
    background: var(--dt-border);
    border-radius: 2px;
    overflow: hidden;
    min-width: 40px;
  }

  .size-bar-fill {
    height: 100%;
    width: 100%;
    background: var(--dt-accent);
    border-radius: 2px;
    /* scaleX (composited) rather than animating width, which triggers layout
       on every data change. transform-origin keeps the fill growing from the
       left edge, matching the old width-based bar. */
    transform-origin: left;
    transition: transform 0.2s;
  }

  .size-value {
    color: var(--dt-text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    width: 56px;
    text-align: right;
  }

  /* --- Raw mode --- */
  .raw-section {
    padding-top: 4px;
  }

  .raw-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .raw-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    font-weight: 500;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 1px solid var(--dt-border);
    color: var(--dt-text-muted);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .copy-btn:hover {
    color: var(--dt-text);
    border-color: var(--dt-text-muted);
  }

  /* --- Notices --- */
  .redirect-notice {
    text-align: left;
    padding: 16px;
  }

  .redirect-notice p {
    margin: 4px 0;
    font-size: 12px;
  }

  .redirect-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-amber);
    margin-bottom: 8px;
  }

  .redirect-hint {
    color: var(--dt-text-muted);
    font-style: italic;
    margin-top: 8px !important;
  }

  .prefetch-notice {
    text-align: left;
    padding: 16px;
  }

  .prefetch-notice p {
    margin: 4px 0;
    font-size: 12px;
  }

  .prefetch-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-cyan);
    margin-bottom: 8px;
  }
</style>
