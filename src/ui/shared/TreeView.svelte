<script lang="ts">
  import { inlineValue } from './format'
  import { childPath } from './tree-search'
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
  // manual expand/collapse state survives the query being cleared.
  const isOpen = $derived((forceExpand?.has(path) ?? false) || (open ?? initialOpen))
  const isMatch = $derived(searchMatches?.has(path) ?? false)

  const isObject = $derived(data !== null && typeof data === 'object' && !Array.isArray(data))
  const isArray = $derived(Array.isArray(data))
  const isExpandable = $derived(isObject || isArray)

  const entries = $derived.by(() => {
    if (isArray) return (data as unknown[]).map((v, i) => [String(i), v] as const)
    if (isObject) return Object.entries(data as Record<string, unknown>)
    return []
  })

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
</script>

<div class="tree-node" style:padding-left="{depth * 14}px">
  {#if isExpandable}
    <button class="toggle" class:match={isMatch} onclick={() => (open = !isOpen)}>
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
      {#if entries.length === 0}
        <span class="empty" style:padding-left="{(depth + 1) * 14}px">empty</span>
      {/if}
    {/if}
  {:else}
    <span class="leaf" class:match={isMatch}>
      {#if label}<span class="key">{label}:</span>{/if}
      <span class={typeClass(data)}>{preview}</span>
    </span>
  {/if}
</div>

<style>
  .tree-node {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11.5px;
    line-height: 1.6;
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
