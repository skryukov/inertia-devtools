<script lang="ts">
  import type { StoreClient } from '../core/client'
  import { createDevToolsContext, type DevToolsContext } from './stores.svelte'
  import TriggerIcon from './TriggerIcon.svelte'
  import PanelContainer from './PanelContainer.svelte'

  let {
    client,
    sharedCtx,
    pip = false,
    styleNonce,
  }: { client: StoreClient; sharedCtx?: DevToolsContext; pip?: boolean; styleNonce?: string } = $props()

  // client is a stable instance — intentionally captured once.
  // The PiP window reuses the docked shell's context so state stays in sync.
  // svelte-ignore state_referenced_locally
  const ctx = sharedCtx ?? createDevToolsContext(client, { styleNonce })

  let rootEl: HTMLDivElement

  // Sync resolved theme to the style scope root: the shadow host element
  // (docked, `:host([data-theme])`) or the popup's <html> (`:root[data-theme]`)
  $effect(() => {
    if (!rootEl) return
    const root = rootEl.getRootNode() as ShadowRoot | Document
    const scopeEl = 'host' in root ? (root.host as HTMLElement) : root.documentElement
    if (scopeEl) scopeEl.dataset.theme = ctx.resolvedTheme
  })

  /**
   * The host app's editing surfaces must never lose keys to the panel:
   * form fields, contenteditable editors (Tiptap/ProseMirror/Lexical), and
   * ARIA widgets that own their arrow keys (listbox/menu/tree/grid...).
   */
  function targetOwnsKeys(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (el.isContentEditable) return true
    const role = el.getAttribute?.('role')
    if (
      role &&
      /^(listbox|option|menu|menuitem|tree|treeitem|grid|gridcell|combobox|tablist|slider|spinbutton)$/.test(role)
    )
      return true
    return false
  }

  // Global keyboard shortcuts — listen on the document owning this instance
  // (the host page when docked, the popup document in PiP mode)
  function handleKeydown(e: KeyboardEvent) {
    // Something else (host app widget) already claimed this key
    if (e.defaultPrevented) return

    // Alt+Shift+D — toggle the panel from anywhere, even while closed.
    // e.code survives keyboard layouts. While popped out, togglePanel
    // focuses the popup instead of toggling (see stores.svelte.ts).
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      if (targetOwnsKeys(e)) return
      e.preventDefault()
      ctx.togglePanel()
      return
    }

    // Remaining shortcuts only apply when panel is open
    if (!ctx.panelOpen) return

    // While popped out, only the popup instance handles shortcuts
    if (ctx.pipOpen && !pip) return

    // Escape — deselect request (back to live view)
    if (e.key === 'Escape') {
      if (targetOwnsKeys(e)) return
      if (ctx.selectedVisitId !== null) {
        ctx.deselectRequest()
      }
      return
    }

    // Arrow keys — navigate request list
    if (targetOwnsKeys(e)) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      ctx.selectNextRequest()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      ctx.selectPrevRequest()
    }
  }

  $effect(() => {
    const doc = rootEl?.ownerDocument ?? document
    doc.addEventListener('keydown', handleKeydown)
    return () => doc.removeEventListener('keydown', handleKeydown)
  })
</script>

<div bind:this={rootEl} class="devtools-wrapper">
  {#if pip}
    <PanelContainer {ctx} pip />
  {:else}
    <TriggerIcon {ctx} />
    {#if ctx.panelOpen && !ctx.pipOpen}
      <PanelContainer {ctx} />
    {/if}
  {/if}
</div>
