<script lang="ts">
  import type { DevToolsContext } from './stores.svelte'
  import { ICON_CLEAR, ICON_MONITOR, ICON_MOON, ICON_SUN, ICON_CLOSE, ICON_PIP } from './shared/icons'
  import RequestList from './RequestList.svelte'
  import DetailPane from './panels/DetailPane.svelte'
  import { isNonEmptyRecord } from './shared/storage'
  import { useResizable } from './shared/resizable.svelte'

  let { ctx, pip = false }: { ctx: DevToolsContext; pip?: boolean } = $props()

  const errorCount = $derived.by(() => {
    const e = ctx.currentPage?.props?.errors
    return isNonEmptyRecord(e) ? Object.keys(e).length : 0
  })

  const panelHeight = useResizable({
    axis: 'y',
    storageKey: 'height',
    min: 200,
    max: () => window.innerHeight - 100,
    initial: 320,
    invert: true,
  })
  const panelWidth = useResizable({
    axis: 'x',
    storageKey: 'width',
    min: 600,
    max: () => window.innerWidth - 32,
    initial: 900,
  })

  // Side edge resize: centered panel needs 2x delta, and left edge is inverted
  /**
   * Shared drag plumbing for the side and corner handles.
   *
   * This is a second, hand-rolled resize implementation living alongside
   * `resizable.svelte.ts`, and it missed that module's fixes. Three of them:
   *
   * - No `pointercancel`. A macOS two-finger back-swipe, or any touch gesture
   *   the browser takes over, fires cancel and never `pointerup` — so the
   *   `pointermove` listener stayed bound to the document forever and every
   *   subsequent mouse movement resized the panel.
   * - `releasePointerCapture` unguarded. After a cancel the capture is already
   *   gone and it throws `InvalidStateError` — into the HOST app's error
   *   reporting, from a devtool.
   * - Bound to `document` rather than the element's own. In the PiP window that
   *   is the wrong document, so dragging a handle there listened on the opener.
   */
  function startDrag(e: PointerEvent, onMove: (ev: PointerEvent) => void, onCommit: () => void) {
    const el = e.currentTarget as Element
    el.setPointerCapture(e.pointerId)
    const doc = el.ownerDocument

    function stop(commit: boolean) {
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* capture already released by the cancel itself */
      }
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerup', onUp)
      doc.removeEventListener('pointercancel', onCancel)
      if (commit) onCommit()
    }
    function onUp() {
      stop(true)
    }
    // Cancelled drags keep the size they reached on screen but are not
    // persisted — the gesture was never finished deliberately.
    function onCancel() {
      stop(false)
    }

    doc.addEventListener('pointermove', onMove)
    doc.addEventListener('pointerup', onUp)
    doc.addEventListener('pointercancel', onCancel)
  }

  function startSideResize(e: PointerEvent, side: 'left' | 'right') {
    const startX = e.clientX
    const startW = panelWidth.size

    startDrag(
      e,
      (ev) => {
        const dx = ev.clientX - startX
        panelWidth._setSize(startW + (side === 'left' ? -dx * 2 : dx * 2))
      },
      () => panelWidth._save(),
    )
  }

  // Corner resize: drag both width and height simultaneously
  function startCornerResize(e: PointerEvent, side: 'left' | 'right') {
    const startX = e.clientX
    const startY = e.clientY
    const startW = panelWidth.size
    const startH = panelHeight.size

    startDrag(
      e,
      (ev) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        panelWidth._setSize(startW + (side === 'left' ? -dx * 2 : dx * 2))
        panelHeight._setSize(startH - dy)
      },
      () => {
        panelWidth._save()
        panelHeight._save()
      },
    )
  }

  // Prevent scroll events from leaking to the host page
  function trapScroll(e: WheelEvent) {
    let el = e.target as HTMLElement | null
    // Use the owning document's view — in PiP mode that's the popup window
    const view = (e.currentTarget as HTMLElement).ownerDocument.defaultView ?? window
    while (el && el !== e.currentTarget) {
      const { overflowY } = view.getComputedStyle(el)
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const { scrollTop, scrollHeight, clientHeight } = el
        const canScroll = scrollHeight > clientHeight
        const atTop = scrollTop <= 0 && e.deltaY < 0
        const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0
        if (canScroll && !atTop && !atBottom) return // let it scroll naturally
      }
      el = el.parentElement
    }
    e.preventDefault()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="panel"
  class:pip
  style:height={pip ? undefined : `${panelHeight.size}px`}
  style:width={pip ? undefined : `${panelWidth.size}px`}
  onwheel={trapScroll}
>
  {#if !pip}
    <!-- Top edge resize handle (height) -->
    <div
      class="resize-handle-top"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize devtools panel height"
      onpointerdown={panelHeight.onResizeStart}
    >
      <div class="resize-grip"></div>
    </div>

    <!-- Left edge resize handle (width) -->
    <div
      class="resize-handle-left"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize devtools panel width"
      onpointerdown={(e) => startSideResize(e, 'left')}
    ></div>

    <!-- Right edge resize handle (width) -->
    <div
      class="resize-handle-right"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize devtools panel width"
      onpointerdown={(e) => startSideResize(e, 'right')}
    ></div>

    <!-- Corner resize handles -->
    <div
      class="resize-handle-corner-tl"
      aria-label="Resize devtools panel"
      onpointerdown={(e) => startCornerResize(e, 'left')}
    ></div>
    <div
      class="resize-handle-corner-tr"
      aria-label="Resize devtools panel"
      onpointerdown={(e) => startCornerResize(e, 'right')}
    ></div>
  {/if}

  <!-- Header bar -->
  <div class="header">
    <div class="header-left">
      <span class="logo">Inertia</span>
      <span class="badge">{ctx.state.requests.length}</span>
      {#if ctx.state.evictedCount > 0}
        <span class="evicted-hint" title="{ctx.state.evictedCount} older requests evicted from buffer">
          (+{ctx.state.evictedCount} evicted)
        </span>
      {/if}
      {#if ctx.currentPage}
        <span class="header-separator"></span>
        <span class="header-component">{ctx.currentPage.component}</span>
        {#if errorCount > 0}
          <span class="error-badge">{errorCount}</span>
        {/if}
      {/if}
    </div>
    <div class="header-right">
      <button class="header-btn" onclick={() => ctx.clearAll()} title="Clear all">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round">{@html ICON_CLEAR}</svg
        >
      </button>
      <button class="header-btn" onclick={() => ctx.cycleTheme()} title="Theme: {ctx.theme}">
        {#if ctx.theme === 'system'}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">{@html ICON_MONITOR}</svg
          >
        {:else if ctx.theme === 'dark'}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">{@html ICON_MOON}</svg
          >
        {:else}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">{@html ICON_SUN}</svg
          >
        {/if}
      </button>
      {#if !pip}
        <button class="header-btn" onclick={() => ctx.openPip()} title="Open in separate window">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">{@html ICON_PIP}</svg
          >
        </button>
      {/if}
      <button
        class="header-btn"
        onclick={() => (pip ? ctx.closePip() : ctx.togglePanel())}
        title={pip ? 'Close window' : 'Close panel'}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round">{@html ICON_CLOSE}</svg
        >
      </button>
    </div>
  </div>

  <!-- Content: master-detail layout -->
  <div class="content">
    <RequestList {ctx} />
    <DetailPane {ctx} />
  </div>
</div>

<style>
  .panel {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    pointer-events: auto;
    background: var(--dt-bg);
    border: 1px solid var(--dt-border);
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    z-index: 2147483646;
  }

  /* PiP window: the panel owns the whole document — no chrome, no resize */
  .panel.pip {
    inset: 0;
    width: 100%;
    height: 100%;
    transform: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  /* Top edge handle (height) */
  .resize-handle-top {
    position: absolute;
    top: -4px;
    left: 8px;
    right: 8px;
    height: 8px;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
  }

  .resize-grip {
    width: 32px;
    height: 3px;
    border-radius: 2px;
    background: var(--dt-border);
    transition: background 0.15s;
  }

  .resize-handle-top:hover .resize-grip {
    background: var(--dt-text-muted);
  }

  /* Left edge handle (width) */
  .resize-handle-left {
    position: absolute;
    top: 8px;
    left: -4px;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
    touch-action: none;
  }

  /* Right edge handle (width) */
  .resize-handle-right {
    position: absolute;
    top: 8px;
    right: -4px;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
    touch-action: none;
  }

  /* Corner handles */
  .resize-handle-corner-tl {
    position: absolute;
    top: -4px;
    left: -4px;
    width: 12px;
    height: 12px;
    cursor: nwse-resize;
    touch-action: none;
    z-index: 1;
  }

  .resize-handle-corner-tr {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 12px;
    height: 12px;
    cursor: nesw-resize;
    touch-action: none;
    z-index: 1;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--dt-border);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .logo {
    font-weight: 600;
    font-size: 13px;
    color: var(--dt-accent);
  }

  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--dt-border);
    color: var(--dt-text-muted);
  }

  .evicted-hint {
    font-size: 10px;
    color: var(--dt-text-muted);
    font-style: italic;
    opacity: 0.7;
  }

  .header-separator {
    width: 1px;
    height: 14px;
    background: var(--dt-border);
  }

  .header-component {
    color: var(--dt-text);
    font-size: 12px;
    font-weight: 500;
    opacity: 0.8;
  }

  .error-badge {
    background: var(--dt-red);
    color: oklch(1 0 0);
    font-size: 10px;
    padding: 0 5px;
    border-radius: 8px;
    font-weight: 600;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .header-btn {
    background: none;
    border: none;
    color: var(--dt-text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .header-btn:hover {
    color: var(--dt-text);
    background: var(--dt-border);
  }

  .content {
    display: flex;
    flex: 1;
    min-height: 0;
  }
</style>
