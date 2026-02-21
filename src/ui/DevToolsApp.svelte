<script lang="ts">
  import type { DevToolsStore } from '../core/store'
  import { createDevToolsContext } from './stores.svelte'
  import TriggerIcon from './TriggerIcon.svelte'
  import PanelContainer from './PanelContainer.svelte'

  let { store }: { store: DevToolsStore } = $props()

  // store is a stable instance — intentionally captured once
  const ctx = createDevToolsContext(store)

  let rootEl: HTMLDivElement

  // Sync resolved theme to the shadow host element
  // so CSS variable overrides :host([data-theme="light"]) take effect
  $effect(() => {
    if (rootEl) {
      const host = rootEl.getRootNode() as ShadowRoot
      if (host?.host) (host.host as HTMLElement).dataset.theme = ctx.resolvedTheme
    }
  })

  // Global keyboard shortcuts — listen on the host document
  function handleKeydown(e: KeyboardEvent) {
    // Shortcuts only apply when panel is open
    if (!ctx.panelOpen) return

    // Escape — deselect request (back to live view), only if not in an input
    if (e.key === 'Escape') {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (ctx.selectedVisitId !== null) {
        ctx.deselectRequest()
      }
      return
    }

    // Arrow keys — navigate request list (only when not in an input)
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      ctx.selectNextRequest()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      ctx.selectPrevRequest()
    }
  }

  $effect(() => {
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  })
</script>

<div bind:this={rootEl} class="devtools-wrapper">
  <TriggerIcon {ctx} />
  {#if ctx.panelOpen}
    <PanelContainer {ctx} />
  {/if}
</div>
