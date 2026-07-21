<script lang="ts">
  import type { DevToolsContext } from '../stores.svelte'
  import { requestToMarkdown, eventsToMarkdown, networkToMarkdown, requestToJSON } from '../../core/markdown'
  import { copyToClipboard } from '../shared/clipboard'
  import { ICON_COPY, ICON_CLOSE } from '../shared/icons'
  import PageView from './PageView.svelte'
  import EventsTab from './EventsTab.svelte'
  import NetworkTab from './NetworkTab.svelte'

  let { ctx }: { ctx: DevToolsContext } = $props()

  const tabs = ['props', 'network', 'events'] as const

  let showRaw = $state(false)
  let toast = $state<string | null>(null)
  let toastTimeout: ReturnType<typeof setTimeout> | undefined

  // Each tab copies its own view of the request as markdown
  const copySource = $derived.by(() => {
    if (ctx.activeTab === 'events') return { title: 'Copy events as Markdown', format: eventsToMarkdown }
    if (ctx.activeTab === 'network') return { title: 'Copy network as Markdown', format: networkToMarkdown }
    return { title: 'Copy request as Markdown', format: requestToMarkdown }
  })

  // Replay is GET-only: re-issuing a mutation would re-submit it. Client-side
  // visits (router.push/replace) have no request to replay. The store guards
  // non-GET again — this gate is for the affordance.
  const canReplay = $derived(
    ctx.canAct && ctx.selectedRequest?.method === 'GET' && ctx.selectedRequest?.type !== 'client',
  )
  const replayTitle = $derived.by(() => {
    if (ctx.selectedRequest?.type === 'client') return 'Client-side visits have no request to replay'
    if (ctx.selectedRequest && ctx.selectedRequest.method !== 'GET')
      return 'Replaying non-GET requests is not supported (would re-submit the mutation)'
    return 'Replay this visit'
  })

  function handleReplay() {
    if (!ctx.selectedRequest || !canReplay) return
    ctx.replayVisit(ctx.selectedRequest.visitId)
    showToast('Replaying...')
  }

  async function handleCopy() {
    if (!ctx.selectedRequest) return
    const ok = await copyToClipboard(copySource.format(ctx.selectedRequest))
    // Say what happened. Clipboard writes fail on non-secure origins and from
    // the unfocused PiP window, and claiming success there sends someone off
    // to paste nothing.
    showToast(ok ? 'Copied!' : 'Copy failed — clipboard unavailable')
  }

  async function handleCopyJSON() {
    if (!ctx.selectedRequest) return
    const ok = await copyToClipboard(requestToJSON(ctx.selectedRequest))
    showToast(ok ? 'Copied JSON!' : 'Copy failed — clipboard unavailable')
  }

  const panelId = 'dt-tabpanel'
  const tabId = (tab: string) => `dt-tab-${tab}`

  /** Roving focus: arrows move between tabs, Home/End jump to the ends. */
  function handleTabKeydown(e: KeyboardEvent) {
    const order: readonly string[] = tabs
    const current = order.indexOf(ctx.activeTab)
    let next = -1
    if (e.key === 'ArrowRight') next = (current + 1) % order.length
    else if (e.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = order.length - 1
    if (next < 0) return
    e.preventDefault()
    // stopPropagation so the panel-wide arrow handler does not also move the
    // request selection while the user is walking the tab strip.
    e.stopPropagation()
    ctx.setActiveTab(order[next])
    const btn = e.currentTarget as HTMLElement | null
    btn?.parentElement?.querySelector<HTMLElement>(`#${CSS.escape(tabId(order[next]))}`)?.focus()
  }

  function showToast(message: string) {
    toast = message
    clearTimeout(toastTimeout)
    toastTimeout = setTimeout(() => {
      toast = null
    }, 3000)
  }
</script>

<div class="detail-pane">
  {#if ctx.selectedRequest}
    <div class="tab-bar">
      <!--
        The WAI-ARIA tabs PATTERN, not just its markup. role="tab" without
        aria-controls, roving tabindex or arrow-key handling announces a tab
        widget to a screen reader and then behaves like a row of buttons —
        worse than plain buttons, because the promise is wrong.
      -->
      <div class="tab-list" role="tablist">
        {#each tabs as tab (tab)}
          <button
            class="tab"
            class:active={ctx.activeTab === tab}
            role="tab"
            id={tabId(tab)}
            aria-controls={panelId}
            aria-selected={ctx.activeTab === tab}
            tabindex={ctx.activeTab === tab ? 0 : -1}
            onclick={() => ctx.setActiveTab(tab)}
            onkeydown={handleTabKeydown}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        {/each}
      </div>
      <div class="tab-bar-right">
        {#if ctx.activeTab === 'props'}
          <div class="mode-toggle">
            <button class="mode-btn" class:active={!showRaw} onclick={() => (showRaw = false)}>Preview</button>
            <button class="mode-btn" class:active={showRaw} onclick={() => (showRaw = true)}>Raw</button>
          </div>
        {/if}
        {#if ctx.canAct}
          <button class="copy-btn" onclick={handleReplay} disabled={!canReplay} title={replayTitle}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3" /></svg
            >
            Replay
          </button>
        {/if}
        <button class="copy-btn" onclick={handleCopy} title={copySource.title}>
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
        {#if ctx.activeTab === 'props'}
          <button class="copy-btn" onclick={handleCopyJSON} title="Copy request as JSON">JSON</button>
        {/if}
        <button class="close-btn" onclick={() => ctx.deselectRequest()} title="Back to live view">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round">{@html ICON_CLOSE}</svg
          >
        </button>
      </div>
    </div>

    <div class="tab-content" role="tabpanel" id={panelId} aria-labelledby={tabId(ctx.activeTab)} tabindex="0">
      {#if ctx.activeTab === 'props'}
        <PageView
          page={ctx.selectedRequest.page ?? null}
          previousPage={ctx.selectedRequest.previousPage}
          features={ctx.selectedRequest.features}
          only={ctx.selectedRequest.only}
          except={ctx.selectedRequest.except}
          type={ctx.selectedRequest.type}
          visitId={ctx.selectedRequest.visitId}
          docsProvider={ctx.docsProvider}
          request={ctx.selectedRequest}
          onCopied={() => showToast('Copied!')}
          {showRaw}
        />
      {:else if ctx.activeTab === 'events'}
        <EventsTab request={ctx.selectedRequest} />
      {:else if ctx.activeTab === 'network'}
        <NetworkTab
          request={ctx.selectedRequest}
          captureMode={ctx.state.networkCaptureMode}
          docsProvider={ctx.docsProvider}
        />
      {/if}
    </div>
  {:else}
    <div class="current-content">
      <PageView
        page={ctx.currentPage}
        previousPage={ctx.currentPagePrevious}
        features={ctx.currentPageFeatures}
        isLive={true}
        componentName={ctx.currentPage?.component}
        docsProvider={ctx.docsProvider}
        onCopied={() => showToast('Copied!')}
      />
    </div>
  {/if}

  <!--
    role="status" + aria-live: the copy-failure toast is the ONLY feedback that
    a clipboard write was blocked, and without a live region a screen-reader
    user got nothing at all — the button appeared to succeed. Rendered
    unconditionally so the region exists before the text arrives; announcing
    into a region that is inserted at the same moment is unreliable.
  -->
  <div class="toast-region" role="status" aria-live="polite">
    {#if toast}
      <div class="toast">{toast}</div>
    {/if}
  </div>
</div>

<style>
  .detail-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .tab-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--dt-border);
    flex-shrink: 0;
    padding: 0 8px;
  }

  .tab-list {
    display: flex;
  }

  .tab {
    background: none;
    border: none;
    color: var(--dt-text-muted);
    font-size: 12px;
    padding: 6px 10px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .tab:hover {
    color: var(--dt-text);
  }

  .tab.active {
    color: var(--dt-accent);
    border-bottom-color: var(--dt-accent);
  }

  .tab-bar-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 1px solid var(--dt-border);
    color: var(--dt-text-muted);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .copy-btn:hover:not(:disabled) {
    color: var(--dt-text);
    border-color: var(--dt-text-muted);
  }

  .copy-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mode-toggle {
    display: flex;
    border-radius: 4px;
    border: 1px solid var(--dt-border);
    overflow: hidden;
  }

  .mode-btn {
    background: none;
    border: none;
    color: var(--dt-text-muted);
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .mode-btn.active {
    background: var(--dt-accent);
    color: white;
  }

  .mode-btn:not(.active):hover {
    color: var(--dt-text);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--dt-text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .close-btn:hover {
    color: var(--dt-text);
    background: var(--dt-border);
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 12px;
  }

  .current-content {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 12px;
  }

  .toast {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--dt-amber);
    color: var(--dt-bg);
    font-size: 11px;
    padding: 6px 14px;
    border-radius: 6px;
    box-shadow: 0 2px 8px oklch(0 0 0 / 0.12);
    white-space: nowrap;
    z-index: 10;
    animation: toast-in 0.2s ease-out;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
