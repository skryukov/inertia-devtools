import { INERTIA_DOM_EVENTS } from './protocol'
import type { InertiaEventName } from './protocol'
import type { DevToolsStore } from './store'
import type { StopFunction } from './types'

interface BufferedEvent {
  name: InertiaEventName
  event: Event
  timestamp: number
}

/**
 * Subscribes to all Inertia events and feeds them into the store.
 * Every handler is wrapped in try/catch -- devtools must NEVER crash the host app.
 *
 * Store dispatch is deferred by one microtask so `defaultPrevented` on
 * inertia:before reflects ALL document listeners (preventDefault is the
 * documented confirm-dialog pattern). inertia:start fires synchronously in the
 * same task right after inertia:before for normal visits, so every event goes
 * through the same queue — relative order is preserved and timestamps are
 * taken at capture time, not flush time.
 *
 * Prefetch detection: Inertia fires the standard DOM event lifecycle
 * (before → start → finish) for prefetch requests too, with visit.prefetch=true.
 * The correlator uses this flag to classify them. No separate router.on() needed.
 *
 * Returns a function to unsubscribe all listeners.
 */
export function startCapture(store: DevToolsStore): StopFunction {
  const removers: StopFunction[] = []
  let buffer: BufferedEvent[] = []
  let stopped = false

  const flush = () => {
    const events = buffer
    buffer = []
    if (stopped) return
    for (const { name, event, timestamp } of events) {
      try {
        store.captureEvent(name, event, timestamp)
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.groupCollapsed('[inertia-devtools] Error capturing event')
          console.error(err)
          console.groupEnd()
        }
      }
    }
  }

  for (const name of INERTIA_DOM_EVENTS) {
    const handler = (e: Event) => {
      if (buffer.length === 0) queueMicrotask(flush)
      buffer.push({ name, event: e, timestamp: performance.now() })
    }

    document.addEventListener(name, handler)
    removers.push(() => document.removeEventListener(name, handler))
  }

  return () => {
    stopped = true
    removers.forEach((r) => r())
  }
}
