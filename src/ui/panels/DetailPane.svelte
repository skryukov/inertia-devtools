<script lang="ts">
  import type { DevToolsContext } from '../stores.svelte'
  import { requestToMarkdown } from '../../core/markdown'
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

  function handleCopy() {
    if (!ctx.selectedRequest) return
    copyToClipboard(requestToMarkdown(ctx.selectedRequest))
    showToast('Copied!')
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
      <div class="tab-list" role="tablist">
        {#each tabs as tab (tab)}
          <button
            class="tab"
            class:active={ctx.activeTab === tab}
            role="tab"
            aria-selected={ctx.activeTab === tab}
            onclick={() => ctx.setActiveTab(tab)}
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
        <button class="copy-btn" onclick={handleCopy} title="Copy as markdown">
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

    <div class="tab-content" role="tabpanel">
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
      />
    </div>
  {/if}

  {#if toast}
    <div class="toast">{toast}</div>
  {/if}
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

  .copy-btn:hover {
    color: var(--dt-text);
    border-color: var(--dt-text-muted);
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
