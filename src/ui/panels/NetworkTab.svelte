<script lang="ts">
  import type { RequestRecord, DocsProvider, NetworkCaptureMode } from '../../core/types'
  import type { HeaderEntry } from '../shared/network-format'
  import { sortedHeaders, statusKind, timingLine, captureModeNotice, isInertiaHeader } from '../shared/network-format'

  let {
    request,
    captureMode = 'pending',
    docsProvider = 'inertiajs',
  }: { request: RequestRecord; captureMode?: NetworkCaptureMode; docsProvider?: DocsProvider } = $props()

  const protocolDocsUrl = 'https://inertiajs.com/the-protocol'

  const wire = $derived(request.wire)
  const requestHeaders = $derived(sortedHeaders(wire?.request?.headers))
  const responseHeaders = $derived(sortedHeaders(wire?.response?.headers))
  const timing = $derived(timingLine(request))
  const notice = $derived(captureModeNotice(captureMode, request))
  const status = $derived(request.status ?? wire?.response?.status)

  /** Inferred protocol details (fallback when no wire data is available). */
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

  const showInferredProtocol = $derived(!wire?.request && !wire?.response && request.type !== 'client')
</script>

<div class="network-tab">
  <!-- Status + timing -->
  {#if status !== undefined || timing}
    <div class="timing-box">
      {#if status !== undefined}
        <span class="status-badge status-{statusKind(status)}">{status}</span>
      {/if}
      <span class="timing-label">{request.method}</span>
      <span class="timing-url">{request.url}</span>
      {#if timing}
        <span class="timing-value">{timing}</span>
      {/if}
    </div>
  {/if}

  {#if notice}
    <div class="notice">{notice}</div>
  {/if}

  <!-- Actual wire headers -->
  {#snippet headersBox(title: string, headers: HeaderEntry[])}
    {#if headers.length > 0}
      <div class="headers-box">
        <div class="headers-title">{title}</div>
        <div class="headers-rows">
          {#each headers as header (header.name)}
            <div class="header-row" class:inertia-header={isInertiaHeader(header.name)}>
              <span class="header-name">{header.name}:</span>
              <span class="header-value">{header.value}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {@render headersBox('Request Headers', requestHeaders)}
  {@render headersBox('Response Headers', responseHeaders)}

  <!-- Inferred protocol details (fallback when interceptors are unavailable) -->
  {#if showInferredProtocol}
    <div class="protocol-box">
      <div class="protocol-header">
        <span class="protocol-title">Inertia Protocol (inferred from client-side data)</span>
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
  {/if}

  {#if !wire && !request.network && !timing && request.type !== 'client'}
    <div class="empty">No network data captured for this visit</div>
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

  .status-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .status-success {
    background: color-mix(in srgb, var(--dt-success, #22c55e) 18%, transparent);
    color: var(--dt-success, #22c55e);
  }

  .status-redirect {
    background: color-mix(in srgb, var(--dt-warning, #f59e0b) 18%, transparent);
    color: var(--dt-warning, #f59e0b);
  }

  .status-error {
    background: color-mix(in srgb, var(--dt-error, #ef4444) 18%, transparent);
    color: var(--dt-error, #ef4444);
  }

  .timing-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    flex-shrink: 0;
  }

  .timing-url {
    color: var(--dt-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timing-value {
    color: var(--dt-text-muted);
    margin-left: auto;
    flex-shrink: 0;
  }

  .notice {
    margin-bottom: 12px;
    padding: 6px 10px;
    border: 1px dashed var(--dt-border);
    border-radius: 6px;
    color: var(--dt-text-muted);
    font-size: 11px;
  }

  .headers-box {
    border: 1px solid var(--dt-border);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 12px;
  }

  .headers-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dt-text-muted);
    margin-bottom: 6px;
  }

  .headers-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .header-row {
    display: flex;
    gap: 6px;
    line-height: 1.5;
    font-family: monospace;
    font-size: 11px;
  }

  .header-row.inertia-header .header-name {
    color: var(--dt-accent);
  }

  .header-name {
    color: var(--dt-text-muted);
    flex-shrink: 0;
  }

  .header-value {
    color: var(--dt-text);
    word-break: break-all;
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
