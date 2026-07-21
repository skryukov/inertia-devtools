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

/**
 * Returns a teardown for the mounted app. Used to return void and drop the
 * unmount function `mountSvelteApp` hands back, which made
 * `destroyInertiaDevtools()` a half-teardown: capture stopped, but the shadow
 * host, the trigger icon, the document keydown listener and the store
 * subscription all stayed. Re-initialising then produced a second set of each.
 */
export async function mountDevTools(
  shadow: ShadowRoot,
  client: StoreClient,
  options: DevToolsOptions,
): Promise<() => void> {
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
  const unmount = await mountSvelteApp(container, client, { styleNonce: options.styleNonce })
  return () => {
    unmount?.()
    style.remove()
    container.remove()
  }
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

      /*
       * Semantic aliases. These were REFERENCED and never defined, so every
       * var(--dt-success|warning|error) fell through to a hardcoded hex
       * fallback that bypassed light-theme tuning entirely (#f59e0b on white is
       * about 2.2:1). Declared once: both scopes target the same host element,
       * so the light block's redefinition of --dt-green et al. flows through.
       */
      --dt-success: var(--dt-green);
      --dt-warning: var(--dt-amber);
      --dt-error: var(--dt-red);

      /*
       * One step dimmer than --dt-text-muted, for explanatory notes. It had no
       * definition and no fallback, so the text simply INHERITED its parent
       * colour and rendered at full strength — the opposite of the intent.
       * L=0.65 measures 5.47:1 on --dt-bg and 4.72:1 on --dt-bg-card, so it
       * clears AA on both surfaces. The light theme overrides it below.
       */
      --dt-text-dim: oklch(0.65 0.013 286);

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

      /*
       * Shadow DOM isolation is ONE-directional. It stops our styles leaking
       * out, but every INHERITED property still crosses in from the host page,
       * and only font/size/line-height/color were being reset. A host setting
       * direction rtl on body rendered the entire panel right-to-left; one
       * setting text-transform uppercase SHOUTED every label; a letter-spacing
       * chosen for a display typeface spaced out the monospace prop tree. All
       * are real things apps set on body.
       */
      direction: ltr;
      text-align: left;
      letter-spacing: normal;
      word-spacing: normal;
      text-transform: none;
      text-indent: 0;
      font-weight: 400;
      font-style: normal;
      font-variant: normal;
      white-space: normal;
      text-shadow: none;
      list-style: none;
      visibility: visible;
      cursor: auto;
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

      /*
       * Equal to --dt-text-muted on purpose. In a light theme "dimmer" means
       * lighter, which lowers contrast — and muted is already only 4.83:1 on
       * white, so there is no headroom to spend. Dimming it further would buy
       * a visual nuance by dropping explanatory text below AA.
       */
      --dt-text-dim: oklch(0.552 0.016 286);

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

    /*
     * One global rule instead of a per-component opt-in. There was a
     * reduced-motion block in TriggerIcon that named '.trigger, .trigger.active'
     * — but the animated classes are '.trigger.pulse' and an infinite 'orbit',
     * so it covered neither, and PageView's infinite '.live-dot' pulse had no
     * block at all. Two of six animations honoured the preference.
     *
     * !important is deliberate: Svelte's scoped styles carry an attribute
     * selector, so anything less loses on specificity — which is exactly how
     * the old rule was defeated. This is the canonical accessibility pattern.
     * A near-zero duration rather than 'none' so animationend still fires and
     * nothing waiting on it hangs.
     */
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }
  `
}
