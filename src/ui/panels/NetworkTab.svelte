<script lang="ts">
  import type { RequestRecord, DocsProvider } from '../../core/types'

  let { request, docsProvider = 'inertiajs' }: { request: RequestRecord; docsProvider?: DocsProvider } = $props()

  const net = $derived(request.network)

  const protocolDocsUrl = 'https://inertiajs.com/the-protocol'

  /** Extract Inertia protocol details from request + page data */
  const protocol = $derived.by(() => {
    const page = request.page
    const opts = request.visitOptions

    const requestVersion = page?.version ?? undefined
    const partialData = request.only ?? null
    const partialExcept = request.except ?? null
    const errorBag = (opts?.errorBag as string) || null
    const resetData = opts?.reset as string[] | null

    return {
      requestVersion,
      partialData,
      partialExcept,
      errorBag,
      resetData,
    }
  })

  function timingLine(): string | null {
    if (!net) return null
    const parts: string[] = []
    if (net.duration) parts.push(`${Math.round(net.duration)}ms`)
    if (net.transferSize !== undefined) parts.push(`${formatBytes(net.transferSize)}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return 'cached'
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }
</script>

<div class="network-tab">
  <!-- Timing -->
  {#if net}
    <div class="timing-box">
      <span class="timing-label">Timing</span>
      <span class="timing-value">{timingLine()}</span>
    </div>
  {/if}

  <!-- Inertia Protocol box -->
  <div class="protocol-box">
    <div class="protocol-header">
      <span class="protocol-title">Inertia Protocol</span>
      <a
        class="protocol-docs-link"
        href={protocolDocsUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Protocol documentation"
      >
        docs &nearr;
      </a>
    </div>
    <div class="protocol-rows">
      <div class="protocol-row">
        <span class="protocol-label">Method:</span>
        <span>{request.method}</span>
      </div>

      {#if protocol.requestVersion}
        <div class="protocol-row" title="X-Inertia-Version header">
          <span class="protocol-label">Version:</span>
          <span>{protocol.requestVersion}</span>
          <span class="header-hint">X-Inertia-Version</span>
        </div>
      {/if}

      {#if request.page?.component}
        <div class="protocol-row" title="X-Inertia-Partial-Component header">
          <span class="protocol-label">Component:</span>
          <span>{request.page.component}</span>
        </div>
      {/if}

      {#if protocol.partialData}
        <div class="protocol-row" title="X-Inertia-Partial-Data header">
          <span class="protocol-label">Partial (only):</span>
          <span class="protocol-tags">
            {#each protocol.partialData as prop}
              <span class="protocol-tag">{prop}</span>
            {/each}
          </span>
          <span class="header-hint">X-Inertia-Partial-Data</span>
        </div>
      {/if}

      {#if protocol.partialExcept}
        <div class="protocol-row" title="X-Inertia-Partial-Except header">
          <span class="protocol-label">Partial (except):</span>
          <span class="protocol-tags">
            {#each protocol.partialExcept as prop}
              <span class="protocol-tag">{prop}</span>
            {/each}
          </span>
          <span class="header-hint">X-Inertia-Partial-Except</span>
        </div>
      {/if}

      {#if protocol.resetData}
        <div class="protocol-row" title="X-Inertia-Reset header">
          <span class="protocol-label">Reset:</span>
          <span class="protocol-tags">
            {#each protocol.resetData as prop}
              <span class="protocol-tag">{prop}</span>
            {/each}
          </span>
          <span class="header-hint">X-Inertia-Reset</span>
        </div>
      {/if}

      {#if protocol.errorBag}
        <div class="protocol-row" title="X-Inertia-Error-Bag header">
          <span class="protocol-label">Error bag:</span>
          <span>{protocol.errorBag}</span>
          <span class="header-hint">X-Inertia-Error-Bag</span>
        </div>
      {/if}
    </div>
  </div>

  {#if !net && request.type !== 'client'}
    <div class="empty">No timing data captured for this visit</div>
  {/if}
</div>

<style>
  .network-tab {
    font-size: 12px;
  }

  .timing-box {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 6px 10px;
    border: 1px solid var(--dt-border);
    border-radius: 6px;
  }

  .timing-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
  }

  .timing-value {
    color: var(--dt-text);
  }

  .protocol-box {
    border: 1px solid var(--dt-border);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 12px;
  }

  .protocol-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .protocol-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
  }

  .protocol-docs-link {
    font-size: 10px;
    color: var(--dt-accent);
    text-decoration: none;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .protocol-docs-link:hover {
    opacity: 1;
    text-decoration: underline;
  }

  .protocol-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .protocol-row {
    display: flex;
    align-items: center;
    gap: 6px;
    line-height: 1.4;
  }

  .protocol-label {
    color: var(--dt-text-muted);
    flex-shrink: 0;
  }

  .header-hint {
    font-size: 10px;
    color: var(--dt-text-muted);
    opacity: 0.5;
    margin-left: auto;
    font-family: monospace;
    flex-shrink: 0;
  }

  .protocol-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .protocol-tag {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--dt-border);
    color: var(--dt-text-muted);
  }

  .empty {
    color: var(--dt-text-muted);
    text-align: center;
    padding: 24px;
  }
</style>
