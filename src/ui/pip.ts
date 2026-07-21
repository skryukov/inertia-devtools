import type { StoreClient } from '../core/client'
import type { DevToolsContext } from './stores.svelte'
import { getBaseStyles, mountSvelteApp } from './mount'

/** Reusing a named window recycles a stale popup instead of stacking new ones. */
export const PIP_WINDOW_NAME = 'inertia-devtools-pip'

const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 500

export interface PipWindowOptions {
  /** Shared reactive context — the popup renders the same state as the docked shell. */
  context: DevToolsContext
  /** Nonce applied to the injected <style> for CSP environments. */
  styleNonce?: string
  width?: number
  height?: number
  /** Fired exactly once when the popup goes away (user close, opener unload, or close()). */
  onClose?: () => void
  /** Injectable for tests — defaults to window.open. */
  openWindow?: (url: string, target: string, features: string) => Window | null
  /** Injectable for tests — defaults to mounting the real Svelte app. */
  mountApp?: typeof mountSvelteApp
  /** Injectable for tests — the window whose unload takes the popup down with it. */
  openerWindow?: Window
}

export interface PipHandle {
  /** The popup window — same-origin about:blank, sharing the opener's realm. */
  window: Window
  focus(): void
  close(): void
}

/**
 * Pop the devtools out into a Picture-in-Picture window.
 *
 * The popup is a same-origin about:blank window running the opener's
 * scripts, so the in-realm StoreClient keeps working unchanged — no
 * serialization, no channel. Returns null when the popup is blocked;
 * callers fall back to the docked panel silently.
 *
 * Must be called from a user gesture — browsers block programmatic
 * window.open outside one.
 */
export function openPipWindow(client: StoreClient, options: PipWindowOptions): PipHandle | null {
  const { context, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT } = options
  const opener = options.openerWindow ?? window
  const open =
    options.openWindow ?? ((url: string, target: string, features: string) => opener.open(url, target, features))

  let win: Window | null = null
  try {
    win = open('', PIP_WINDOW_NAME, `width=${width},height=${height},popup`)
  } catch {
    win = null
  }
  if (!win) return null

  const doc = win.document

  // Wipe whatever a recycled named window still contains
  doc.head.innerHTML = ''
  doc.body.innerHTML = ''
  doc.title = 'Inertia DevTools'

  // Base styles scope to :root instead of :host — the popup document is ours
  const style = doc.createElement('style')
  if (options.styleNonce) {
    style.nonce = options.styleNonce
  }
  style.textContent = `${getBaseStyles(':root')}
    html, body { margin: 0; height: 100%; background: var(--dt-bg); }
  `
  doc.head.appendChild(style)

  // Apply the current theme immediately; the app's $effect keeps it in sync
  doc.documentElement.dataset.theme = context.resolvedTheme

  const container = doc.createElement('div')
  container.id = 'inertia-devtools-root'
  doc.body.appendChild(container)

  // Mount the same Svelte app, reusing the docked shell's reactive context
  const mountApp = options.mountApp ?? mountSvelteApp
  const mounted = mountApp(container, client, { sharedCtx: context, pip: true, styleNonce: options.styleNonce })

  // --- Close lifecycle: onClose fires exactly once, however the popup dies ---
  let closed = false

  function notifyClose() {
    if (closed) return
    closed = true
    opener.removeEventListener('beforeunload', closePopup)
    opener.removeEventListener('pagehide', closePopup)
    // Tear down the popup's app instance so its effects (keyboard listener,
    // theme sync) don't keep running against a dead document. Unmounting
    // against an already-destroyed document must never throw into the host.
    void mounted.then((unmountApp) => {
      try {
        unmountApp?.()
      } catch {
        // Popup document already gone — effects died with it
      }
    })
    options.onClose?.()
  }

  function closePopup() {
    try {
      win?.close()
    } catch {
      // Window already gone — nothing to close
    }
    notifyClose()
  }

  // Popup closed by the user (its own close button / window controls)
  win.addEventListener('pagehide', notifyClose)

  // Opener navigating away or closing takes the popup down with it
  opener.addEventListener('beforeunload', closePopup)
  opener.addEventListener('pagehide', closePopup)

  return {
    window: win,
    focus: () => {
      try {
        win.focus()
      } catch {
        // Window already gone — nothing to focus
      }
    },
    close: closePopup,
  }
}
