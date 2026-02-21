import { INERTIA_DOM_EVENTS } from './protocol'
import type { InertiaEventName } from './protocol'
import type { DevToolsStore } from './store'
import type { StopFunction } from './types'

/**
 * Subscribes to all Inertia events and feeds them into the store.
 * Every handler is wrapped in try/catch -- devtools must NEVER crash the host app.
 *
 * Prefetch detection: Inertia fires the standard DOM event lifecycle
 * (before → start → finish) for prefetch requests too, with visit.prefetch=true.
 * The correlator uses this flag to classify them. No separate router.on() needed.
 *
 * Returns a function to unsubscribe all listeners.
 */
export function startCapture(store: DevToolsStore): StopFunction {
  const removers: StopFunction[] = []

  for (const name of INERTIA_DOM_EVENTS) {
    const handler = (e: Event) => {
      try {
        store.captureEvent(name as InertiaEventName, e)
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.groupCollapsed('[inertia-devtools] Error capturing event')
          console.error(err)
          console.groupEnd()
        }
      }
    }

    document.addEventListener(name, handler)
    removers.push(() => document.removeEventListener(name, handler))
  }

  return () => {
    removers.forEach((r) => r())
  }
}
