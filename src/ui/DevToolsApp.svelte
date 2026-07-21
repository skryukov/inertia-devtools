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

  // $state so the effects that read it re-run if bind:this ever lands late;
  // the keyboard handler now depends on it to scope arrow keys to the panel.
  let rootEl = $state<HTMLDivElement | undefined>()

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
    // composedPath()[0], not e.target: the listener is on the document, and
    // anything inside a shadow root — including the devtools' own Filter and
    // Search boxes, and any web-component input in the host app (Shoelace,
    // Lit, Ionic) — is retargeted to the shadow host before it reaches us.
    // Reading e.target there sees a DIV, decides nobody owns the keys, and
    // preventDefault()s arrow keys while the user is typing.
    const el = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null
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

  /** Did this event originate inside the devtools UI (shadow root or PiP window)? */
  function eventIsInsideDevtools(e: KeyboardEvent): boolean {
    if (!rootEl) return false
    const path = e.composedPath?.()
    if (path?.length) return path.includes(rootEl)
    // No composedPath (very old engines): fall back to containment.
    const el = e.target as Node | null
    return Boolean(el && rootEl.contains(el))
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

    // Arrow keys browse the request list — but only while the focus is inside
    // the devtools. Swallowing them globally killed plain scroll-by-arrow-key
    // in the user's app for as long as the panel was open, and `panelOpen`
    // persists across reloads, so it read as "arrow keys stopped working".
    if (targetOwnsKeys(e)) return
    if (!eventIsInsideDevtools(e)) return

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
