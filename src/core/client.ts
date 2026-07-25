import type { DevToolsStore } from './store'
import type { DevToolsState, DocsProvider, SessionRequestSummary } from './types'

/**
 * Static configuration delivered once when a shell connects.
 * Plain-JSON-shaped so a future cross-realm shell (PiP window, iframe,
 * extension) can receive it in a handshake message.
 */
export interface ClientHello {
  docsProvider: DocsProvider
  previousSessionRequests: SessionRequestSummary[]
  /** Router actions (replayVisit/reload) are available — a router was provided. */
  canAct: boolean
  /** The dev server can open a component's source in the editor (Vite dev only). */
  sourceLinks: boolean
}

// --- Protocol messages (future wire) ---
// Types only for now: cross-realm shells will exchange exactly these
// plain-JSON frames over a channel; the in-realm client shares object
// references and skips the wire entirely.

/** Handshake frame: static config sent once when a shell connects. */
export interface HelloMessage {
  type: 'hello'
  /** Protocol version — bump on breaking frame changes. */
  version: 1
  hello: ClientHello
}

/** State frame: full snapshot pushed on every store change. */
export interface StateMessage {
  type: 'state'
  state: DevToolsState
}

/** Commands a shell can send back to the page-side store. */
export type StoreCommand =
  | { name: 'clear' }
  | { name: 'setPanelOpen'; open: boolean }
  | { name: 'replayVisit'; visitId: number }
  | { name: 'reload' }

/** Command frame: UI → store action. */
export interface CommandMessage {
  type: 'command'
  command: StoreCommand
}

export type ProtocolMessage = HelloMessage | StateMessage | CommandMessage

/**
 * The boundary the UI consumes instead of the raw DevToolsStore.
 * Mirrors the protocol above: `hello` is the handshake payload,
 * getState/subscribe carry state frames, the remaining methods are commands.
 * Future shells implement this same interface over a real transport.
 */
export interface StoreClient {
  /** Static config received once at connection time (see HelloMessage). */
  readonly hello: ClientHello
  getState(): DevToolsState
  subscribe(fn: (state: DevToolsState) => void): () => void
  clear(): void
  setPanelOpen(open: boolean): void
  /** Re-issue a captured GET visit through the app's router (no-op when !canAct). */
  replayVisit(visitId: number): void
  /** Reload the current page through the app's router (no-op when !canAct). */
  reload(): void
}

/**
 * In-realm StoreClient: a thin adapter over a store living in the same
 * realm. Shares object references — no serialization, no channel — so
 * today's behavior is preserved exactly.
 */
export function createInRealmClient(store: DevToolsStore): StoreClient {
  return {
    hello: {
      docsProvider: store.docsProvider,
      previousSessionRequests: store.previousSessionRequests,
      canAct: store.canAct,
      sourceLinks: store.sourceLinks,
    },
    getState: () => store.getState(),
    subscribe: (fn) => store.subscribe(fn),
    clear: () => store.clear(),
    setPanelOpen: (open) => store.setPanelOpen(open),
    replayVisit: (visitId) => store.replayVisit(visitId),
    reload: () => store.reload(),
  }
}
