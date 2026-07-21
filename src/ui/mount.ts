import type { StoreClient } from '../core/client'
import type { DevToolsOptions } from '../core/types'
import type { DevToolsContext } from './stores.svelte'

/** Optional props forwarded to the Svelte app (see DevToolsApp.svelte). */
export interface DevToolsAppProps {
  /** Reuse an existing reactive context instead of creating one (PiP window). */
  sharedCtx?: DevToolsContext
  /** Render as a Picture-in-Picture window: panel only, filling the document. */
  pip?: boolean
  /** Nonce forwarded to styles injected later (e.g. into the PiP window). */
  styleNonce?: string
}

export function mountDevTools(shadow: ShadowRoot, client: StoreClient, options: DevToolsOptions): void {
  // Inject base styles
  const style = document.createElement('style')
  if (options.styleNonce) {
    style.nonce = options.styleNonce
  }
  style.textContent = getBaseStyles()
  shadow.appendChild(style)

  // Create container for Svelte app
  const container = document.createElement('div')
  container.id = 'inertia-devtools-root'
  shadow.appendChild(container)

  // Mount Svelte app
  mountSvelteApp(container, client, { styleNonce: options.styleNonce })
}

export async function mountSvelteApp(
  target: HTMLElement,
  client: StoreClient,
  appProps: DevToolsAppProps = {},
): Promise<(() => void) | undefined> {
  try {
    const { mount, unmount } = await import('svelte')
    const { default: DevToolsApp } = await import('./DevToolsApp.svelte')

    const app = mount(DevToolsApp, {
      target,
      props: { client, ...appProps },
    })
    return () => unmount(app)
  } catch (err) {
    // Fallback: show error message in shadow DOM
    target.innerHTML = `
      <div style="position:fixed;bottom:16px;right:16px;pointer-events:auto;
                  padding:12px 16px;background:#18181b;color:#a1a1aa;
                  border-radius:8px;font:13px/1.4 system-ui;
                  border:1px solid #27272a;max-width:300px;">
        <strong style="color:#fafafa;">Inertia DevTools</strong><br>
        Failed to load UI. Check console for details.
      </div>
    `
    if (typeof console !== 'undefined') {
      console.groupCollapsed('[inertia-devtools] Failed to mount Svelte app')
      console.error(err)
      console.groupEnd()
    }
    return undefined
  }
}

/**
 * Base styles for the devtools UI. Scoped to `:host` for the docked
 * Shadow DOM shell, or `:root` when injected into a document the
 * devtools own outright (the PiP window).
 */
export function getBaseStyles(scope: ':host' | ':root' = ':host'): string {
  const lightScope = scope === ':host' ? ':host([data-theme="light"])' : ':root[data-theme="light"]'
  return `
    ${scope} {
      /* Base surface colors */
      --dt-bg: oklch(0.21 0.006 286);
      --dt-bg-card: oklch(0.274 0.006 286);
      --dt-border: oklch(0.333 0.01 286);
      --dt-text: oklch(0.985 0 0);
      --dt-text-muted: oklch(0.716 0.013 286);

      /* Accent — Inertia brand #2563EB */
      --dt-accent: oklch(0.546 0.215 264);

      /* Semantic colors */
      --dt-green: oklch(0.723 0.191 149);
      --dt-red: oklch(0.627 0.222 25);
      --dt-blue: oklch(0.623 0.185 259);
      --dt-purple: oklch(0.627 0.225 303);
      --dt-amber: oklch(0.769 0.171 70);
      --dt-cyan: oklch(0.715 0.127 207);
      --dt-teal: oklch(0.704 0.119 182);
      --dt-emerald: oklch(0.696 0.17 162);
      --dt-yellow: oklch(0.795 0.184 86);

      /* Opacity-based state colors — swap overlay base per theme */
      --dt-overlay: 1 0 0; /* white in dark mode */
      --dt-hover: oklch(var(--dt-overlay) / 0.05);
      --dt-row-added: oklch(0.723 0.191 149 / 0.08);
      --dt-row-removed: oklch(0.627 0.222 25 / 0.08);
      --dt-row-changed: oklch(0.795 0.184 86 / 0.08);

      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: var(--dt-text);
    }

    ${lightScope} {
      --dt-bg: oklch(1 0 0);
      --dt-bg-card: oklch(0.967 0.003 286);
      --dt-border: oklch(0.92 0.004 286);
      --dt-text: oklch(0.205 0.006 286);
      --dt-text-muted: oklch(0.552 0.016 286);

      --dt-accent: oklch(0.488 0.217 264);

      --dt-green: oklch(0.56 0.175 149);
      --dt-red: oklch(0.535 0.22 25);
      --dt-blue: oklch(0.488 0.217 264);
      --dt-purple: oklch(0.494 0.23 303);
      --dt-amber: oklch(0.606 0.165 70);
      --dt-cyan: oklch(0.547 0.12 207);
      --dt-teal: oklch(0.536 0.112 182);
      --dt-emerald: oklch(0.528 0.155 162);
      --dt-yellow: oklch(0.636 0.165 86);

      --dt-overlay: 0 0 0; /* black in light mode */
      --dt-hover: oklch(var(--dt-overlay) / 0.04);
      --dt-row-added: oklch(0.56 0.175 149 / 0.1);
      --dt-row-removed: oklch(0.535 0.22 25 / 0.1);
      --dt-row-changed: oklch(0.636 0.165 86 / 0.1);
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    /* Thin scrollbars — standard property (Firefox, Chrome 121+) */
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--dt-border) transparent;
    }

    /* WebKit scrollbars (Safari, older Chrome) */
    *::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    *::-webkit-scrollbar-track {
      background: transparent;
    }
    *::-webkit-scrollbar-thumb {
      background: var(--dt-border);
      border-radius: 3px;
    }
    *::-webkit-scrollbar-thumb:hover {
      background: var(--dt-text-muted);
    }

    #inertia-devtools-root {
      pointer-events: auto;
    }
  `
}
