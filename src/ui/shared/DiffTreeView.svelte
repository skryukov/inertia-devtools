<script lang="ts">
  import { inlineValue } from './format'
  import DiffTreeView from './DiffTreeView.svelte'
  import type { DiffNode } from '../../core/diff'

  let {
    nodes,
    depth = 0,
    showUnchanged = false,
  }: {
    nodes: DiffNode[]
    depth?: number
    showUnchanged?: boolean
  } = $props()

  const visibleNodes = $derived(showUnchanged ? nodes : nodes.filter((n) => n.type !== 'unchanged'))

  function formatValue(val: unknown): string {
    return inlineValue(val, 60)
  }

  function valueClass(val: unknown): string {
    if (val === null || val === undefined) return 'val-null'
    if (typeof val === 'string') return 'val-string'
    if (typeof val === 'number') return 'val-number'
    if (typeof val === 'boolean') return 'val-boolean'
    return ''
  }

  // Default-expand nested nodes; user toggles are preserved until nodes change
  function nestedKeys() {
    return nodes.filter((n) => n.type === 'nested').map((n) => n.key)
  }
  const nestedKeyFingerprint = $derived(nestedKeys().join('\0'))
  let expandedKeys = $state<Set<string>>(new Set())
  let prevFingerprint = ''

  $effect(() => {
    if (nestedKeyFingerprint !== prevFingerprint) {
      prevFingerprint = nestedKeyFingerprint
      expandedKeys = new Set(nestedKeys())
    }
  })

  function toggleExpand(key: string) {
    const next = new Set(expandedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedKeys = next
  }
</script>

<div class="diff-tree" style:padding-left="{depth * 14}px">
  {#if visibleNodes.length === 0}
    <span class="no-changes">No changes</span>
  {/if}
  {#each visibleNodes as node (node.key)}
    <div class="diff-row diff-{node.type}">
      {#if node.type === 'added'}
        <span class="diff-marker">+</span>
        <span class="diff-key">{node.key}:</span>
        <span class={valueClass(node.newValue)}>{formatValue(node.newValue)}</span>
      {:else if node.type === 'removed'}
        <span class="diff-marker">−</span>
        <span class="diff-key">{node.key}:</span>
        <span class="val-removed">{formatValue(node.oldValue)}</span>
      {:else if node.type === 'changed'}
        <span class="diff-marker">~</span>
        <span class="diff-key">{node.key}:</span>
        <span class="val-removed">{formatValue(node.oldValue)}</span>
        <span class="diff-arrow">&rarr;</span>
        <span class={valueClass(node.newValue)}>{formatValue(node.newValue)}</span>
      {:else if node.type === 'nested'}
        <button class="diff-nested-toggle" onclick={() => toggleExpand(node.key)}>
          <span class="expand-arrow">{expandedKeys.has(node.key) ? '\u25BE' : '\u25B8'}</span>
          <span class="diff-marker">~</span>
          <span class="diff-key">{node.key}</span>
          <span class="nested-hint">{node.children?.filter((c) => c.type !== 'unchanged').length} changes</span>
        </button>
        {#if expandedKeys.has(node.key) && node.children}
          <DiffTreeView nodes={node.children} depth={depth + 1} {showUnchanged} />
        {/if}
      {:else}
        <span class="diff-marker unchanged-marker">&middot;</span>
        <span class="diff-key unchanged-key">{node.key}:</span>
        <span class="val-unchanged">{formatValue(node.newValue)}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .diff-tree {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11.5px;
    line-height: 1.7;
  }

  .diff-row {
    display: flex;
    align-items: baseline;
    gap: 5px;
    padding: 0 4px;
    border-radius: 2px;
  }

  .diff-added {
    background: var(--dt-row-added);
  }

  .diff-removed {
    background: var(--dt-row-removed);
  }

  .diff-changed {
    background: var(--dt-row-changed);
  }

  .diff-marker {
    font-weight: 700;
    width: 12px;
    flex-shrink: 0;
    text-align: center;
  }

  .diff-added .diff-marker {
    color: var(--dt-green);
  }
  .diff-removed .diff-marker {
    color: var(--dt-red);
  }
  .diff-changed .diff-marker {
    color: var(--dt-amber);
  }
  .unchanged-marker {
    color: var(--dt-text-muted);
    opacity: 0.3;
  }

  .diff-key {
    color: var(--dt-purple);
  }

  .unchanged-key {
    opacity: 0.5;
  }

  .diff-arrow {
    color: var(--dt-text-muted);
    font-size: 10px;
  }

  .val-string {
    color: var(--dt-green);
  }
  .val-number {
    color: var(--dt-blue);
  }
  .val-boolean {
    color: var(--dt-amber);
  }
  .val-null {
    color: var(--dt-text-muted);
    font-style: italic;
  }
  .val-removed {
    color: var(--dt-red);
    text-decoration: line-through;
    opacity: 0.7;
  }
  .val-unchanged {
    color: var(--dt-text-muted);
    opacity: 0.5;
  }

  .diff-nested-toggle {
    display: flex;
    align-items: baseline;
    gap: 5px;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }

  .diff-nested-toggle:hover {
    background: var(--dt-hover);
  }

  .expand-arrow {
    font-size: 12px;
    color: var(--dt-text-muted);
    width: 10px;
  }

  .nested-hint {
    font-size: 10px;
    color: var(--dt-amber);
    opacity: 0.7;
  }

  .no-changes {
    color: var(--dt-text-muted);
    font-style: italic;
    padding: 4px 0;
  }
</style>
