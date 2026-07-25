<script lang="ts">
  import { inlineValue } from './format'
  import { childPath } from './tree-search'

  /** Max children rendered per node while a search is active — see `entries`. */
  const MAX_RENDERED_CHILDREN = 50
  const SHOW_MORE_BATCH = 100
  import TreeView from './TreeView.svelte'

  let {
    data,
    label = '',
    depth = 0,
    defaultOpen = false,
    path = '',
    searchMatches,
    forceExpand,
  }: {
    data: unknown
    label?: string
    depth?: number
    defaultOpen?: boolean
    /** This node's dot/bracket path within the searched tree (see tree-search.ts). */
    path?: string
    /** Paths of nodes matching the active search query — highlighted. */
    searchMatches?: Set<string>
    /** Paths to auto-expand while a search query is active. */
    forceExpand?: Set<string>
  } = $props()

  const initialOpen = $derived(defaultOpen || depth < 1)
  let open = $state<boolean | null>(null)
  // Search expansion is a separate layer merged at render time so the user's
  // manual expand/collapse state survives the query being cleared. An explicit
  // toggle wins over it: with `forceExpand` OR-ed on top, clicking to collapse
  // a noisy subtree during a search did nothing — the arrow did not even flip.
  const isOpen = $derived(open ?? ((forceExpand?.has(path) ?? false) || initialOpen))
  const isMatch = $derived(searchMatches?.has(path) ?? false)

  const isObject = $derived(data !== null && typeof data === 'object' && !Array.isArray(data))
  const isArray = $derived(Array.isArray(data))
  const isExpandable = $derived(isObject || isArray)

  const allEntries = $derived.by(() => {
    if (isArray) return (data as unknown[]).map((v, i) => [String(i), v] as const)
    if (isObject) return Object.entries(data as Record<string, unknown>)
    return []
  })

  /** A search is running when the parent handed us result sets. */
  const searching = $derived(Boolean(searchMatches || forceExpand))

  /**
   * While searching, render only children on a match path.
   *
   * Expanding a node used to render ALL of its children, so a query matching
   * deep inside a large collection expanded ~1,000 paths and mounted several
   * thousand nested TreeViews synchronously — on the host app's main thread,
   * because the devtools share it. Typing "e" (the first letter of "email")
   * was enough. The 150ms debounce delayed that, it did not prevent it.
   */
  const matchingEntries = $derived.by(() => {
    if (!searching) return allEntries
    return allEntries.filter(([key]) => {
      const child = childPath(path, key, isArray)
      return searchMatches?.has(child) || forceExpand?.has(child)
    })
  })

  /**
   * The render budget is UNCONDITIONAL, not search-only. It used to bind only
   * while a query was active, so expanding a plain `{ users: Array(10_000) }`
   * mounted 10,002 nested components synchronously on the host app's main
   * thread — and that expand is the whole point of the tool. A one-letter query
   * like "e" also barely reduces a collection (every email/name/role contains
   * one), which is why the cap has to apply to the matched set too.
   *
   * `shownLimit` grows on demand via the "Show N more" affordance, so nothing is
   * permanently hidden — it is deferred until the user asks, off the first-paint
   * path.
   */
  let shownLimit = $state(MAX_RENDERED_CHILDREN)
  const renderSource = $derived(searching ? matchingEntries : allEntries)
  const entries = $derived(renderSource.slice(0, shownLimit))

  /** Over the render budget (revealable). */
  const cappedCount = $derived(renderSource.length - entries.length)
  /** Filtered out by the search entirely (only a new query brings them back). */
  const hiddenCount = $derived(searching ? allEntries.length - matchingEntries.length : 0)

  function showMore() {
    shownLimit += SHOW_MORE_BATCH
  }

  const preview = $derived.by(() => {
    if (data === null) return 'null'
    if (data === undefined) return 'undefined'
    if (typeof data === 'string') return `"${data.length > 80 ? data.slice(0, 80) + '…' : data}"`
    if (typeof data === 'boolean') return String(data)
    if (typeof data === 'number') return String(data)
    if (isArray) {
      if ((data as unknown[]).length === 0) return '[]'
      const items = (data as unknown[]).slice(0, 3).map((v) => inlineValue(v))
      return `[${items.join(', ')}${(data as unknown[]).length > 3 ? ', …' : ''}]`
    }
    if (isObject) {
      const obj = data as Record<string, unknown>
      const keys = Object.keys(obj)
      if (keys.length === 0) return '{}'
      const pairs = keys.slice(0, 3).map((k) => `${k}: ${inlineValue(obj[k])}`)
      return `{${pairs.join(', ')}${keys.length > 3 ? ', …' : ''}}`
    }
    return String(data)
  })

  function typeClass(val: unknown): string {
    if (val === null || val === undefined) return 'null'
    if (typeof val === 'string') return 'string'
    if (typeof val === 'number') return 'number'
    if (typeof val === 'boolean') return 'boolean'
    return ''
  }

  /**
   * WAI-ARIA tree keyboard handling, on the ROOT node only (depth 0). The tree
   * used to be a wall of bare <button>s: expanding a 500-item array created 502
   * Tab stops, expansion was conveyed only by a ▸/▾ glyph, and a screen reader
   * saw a flat list of buttons, not a tree. Now each node is a `treeitem` with
   * `aria-level`/`aria-expanded`, the items are tabindex=-1 (one Tab stop for
   * the whole tree), and arrows move focus / expand-collapse.
   *
   * Flat `aria-level` rather than nested `group`s: it conveys the same hierarchy
   * without restructuring the DOM, so the existing indentation and render budget
   * are untouched. Focus is resolved through `getRootNode()` so it works inside
   * the shadow root, where `document.activeElement` only sees the host.
   */
  let rootEl = $state<HTMLElement | undefined>()

  function treeItems(): HTMLElement[] {
    if (!rootEl) return []
    return [...rootEl.querySelectorAll<HTMLElement>('[role="treeitem"]')]
  }

  function focusAt(items: HTMLElement[], index: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, index))
    items[clamped]?.focus()
  }

  function onTreeKeydown(e: KeyboardEvent) {
    const items = treeItems()
    if (items.length === 0) return
    const root = rootEl?.getRootNode() as Document | ShadowRoot | undefined
    const active = (root?.activeElement ?? null) as HTMLElement | null
    const idx = active ? items.indexOf(active) : -1

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusAt(items, idx + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusAt(items, idx - 1)
        break
      case 'Home':
        e.preventDefault()
        focusAt(items, 0)
        break
      case 'End':
        e.preventDefault()
        focusAt(items, items.length - 1)
        break
      case 'ArrowRight':
        e.preventDefault()
        // Collapsed → expand in place; already-expanded/leaf → step into it.
        if (items[idx]?.getAttribute('aria-expanded') === 'false') items[idx].click()
        else if (idx >= 0) focusAt(items, idx + 1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        // Expanded → collapse; leaf/collapsed → step back out.
        if (items[idx]?.getAttribute('aria-expanded') === 'true') items[idx].click()
        else if (idx > 0) focusAt(items, idx - 1)
        break
    }
  }
</script>

<!-- role="tree" and the keyboard handler live on the ROOT node only; deeper
     nodes are generic wrappers and convey their depth through aria-level.
     svelte-ignore a11y_no_noninteractive_tabindex: a tree container is an
     interactive composite widget and legitimately takes focus (WAI-ARIA tree
     pattern); the rule does not recognise role="tree" as interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="tree-node"
  style:padding-left="{depth * 14}px"
  role={depth === 0 ? 'tree' : undefined}
  tabindex={depth === 0 ? 0 : undefined}
  aria-label={depth === 0 ? 'Property tree' : undefined}
  onkeydown={depth === 0 ? onTreeKeydown : undefined}
  bind:this={rootEl}
>
  {#if isExpandable}
    <button
      class="toggle"
      class:match={isMatch}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isOpen}
      aria-selected={false}
      tabindex="-1"
      onclick={() => (open = !isOpen)}
    >
      <span class="arrow" class:open={isOpen}>{isOpen ? '\u25BE' : '\u25B8'}</span>
      {#if label}<span class="key">{label}:</span>{/if}
      <span class="preview {typeClass(data)}">{preview}</span>
    </button>
    {#if isOpen}
      {#each entries as [key, value] (key)}
        <TreeView
          data={value}
          label={key}
          depth={depth + 1}
          path={childPath(path, key, isArray)}
          {searchMatches}
          {forceExpand}
        />
      {/each}
      {#if cappedCount > 0}
        <div class="filtered-note" style:padding-left="{(depth + 1) * 14}px">
          <button class="show-more" onclick={showMore}>
            Show {Math.min(cappedCount, SHOW_MORE_BATCH)} more
          </button>
          <span>{cappedCount} not shown</span>
        </div>
      {/if}
      {#if hiddenCount > 0}
        <div class="filtered-note" style:padding-left="{(depth + 1) * 14}px">
          {hiddenCount} non-matching {hiddenCount === 1 ? 'key' : 'keys'} hidden
        </div>
      {/if}
      {#if entries.length === 0}
        <span class="empty" style:padding-left="{(depth + 1) * 14}px">empty</span>
      {/if}
    {/if}
  {:else}
    <span class="leaf" class:match={isMatch} role="treeitem" aria-level={depth + 1} aria-selected={false} tabindex="-1">
      {#if label}<span class="key">{label}:</span>{/if}
      <span class={typeClass(data)}>{preview}</span>
    </span>
  {/if}
</div>

<style>
  .filtered-note {
    font-size: 11px;
    font-style: italic;
    color: var(--dt-text-dim);
    padding-block: 2px;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }

  .show-more {
    font: inherit;
    font-style: normal;
    color: var(--dt-accent);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
  }

  .show-more:hover {
    color: var(--dt-text);
  }

  .tree-node {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    line-height: 1.5;
  }

  .toggle {
    background: none;
    border: none;
    color: var(--dt-text);
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: baseline;
    gap: 4px;
    font: inherit;
    text-align: left;
    width: 100%;
    min-width: 0;
  }

  .toggle:hover {
    background: var(--dt-hover);
  }

  .toggle.match,
  .leaf.match {
    background: var(--dt-row-changed);
    border-radius: 3px;
  }

  .arrow {
    font-size: 10px;
    width: 10px;
    display: inline-block;
    color: var(--dt-text-muted);
    flex-shrink: 0;
  }

  .leaf {
    display: flex;
    gap: 4px;
    align-items: baseline;
    min-width: 0;
    padding-left: 14px;
  }

  .key {
    color: var(--dt-purple);
    flex-shrink: 0;
  }

  .preview {
    color: var(--dt-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .string {
    color: var(--dt-green);
  }
  .number {
    color: var(--dt-blue);
  }
  .boolean {
    color: var(--dt-amber);
  }
  .null {
    color: var(--dt-text-muted);
    font-style: italic;
  }

  .empty {
    color: var(--dt-text-muted);
    font-style: italic;
    font-size: 11px;
  }
</style>
