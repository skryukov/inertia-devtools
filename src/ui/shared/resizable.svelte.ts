import { loadSetting, saveSetting } from './storage'

/**
 * Reactive resize state for pointer-drag resizing along a single axis.
 * Uses document-level move/up listeners during active drag to prevent
 * the handle element from interfering with scrolling when not resizing.
 */
export function useResizable(opts: {
  axis: 'x' | 'y'
  storageKey: string
  min: number
  max: number | (() => number)
  initial: number
  /** 'y' axis uses inverted delta (drag up = grow). Default: false. */
  invert?: boolean
}) {
  const { axis, storageKey, min, initial, invert = false } = opts
  const getMax = typeof opts.max === 'function' ? opts.max : () => opts.max as number

  let size = $state(initial)
  let resizing = $state(false)
  let startPos = 0
  let startSize = 0

  // Restore from localStorage
  const saved = loadSetting(storageKey, '')
  if (saved) size = Math.max(min, Math.min(getMax(), Number(saved) || initial))

  function clamp(v: number) {
    return Math.max(min, Math.min(getMax(), v))
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizing) return
    const pos = axis === 'x' ? e.clientX : e.clientY
    const rawDelta = pos - startPos
    const delta = invert ? -rawDelta : rawDelta
    size = clamp(startSize + delta)
  }

  let captureTarget: Element | null = null
  /**
   * The document the drag is actually happening in — NOT the module-global
   * `document`, which is the opener's. Popped out into the PiP window the
   * handle lives in the popup's document, so listeners bound to the opener
   * never fired: `onResizeEnd` never ran, the listeners were never removed and
   * `resizing` latched true, after which every mouse move anywhere in the
   * user's app resized the panel.
   */
  let dragDoc: Document | null = null

  function onResizeEnd(e: PointerEvent) {
    if (!resizing) return
    resizing = false
    if (captureTarget) {
      // Already released implicitly (the element was detached, the pointer was
      // cancelled) — throwing here would skip the cleanup below.
      try {
        captureTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* nothing to release */
      }
      captureTarget = null
    }
    dragDoc?.removeEventListener('pointermove', onResizeMove)
    dragDoc?.removeEventListener('pointerup', onResizeEnd)
    // pointercancel fires INSTEAD of pointerup when a browser gesture steals
    // the pointer (macOS back-swipe, pen input). Without it the drag never
    // ended and the listeners stayed bound to the document forever.
    dragDoc?.removeEventListener('pointercancel', onResizeEnd)
    dragDoc = null
    saveSetting(storageKey, String(size))
  }

  function onResizeStart(e: PointerEvent) {
    resizing = true
    startPos = axis === 'x' ? e.clientX : e.clientY
    startSize = size
    // Capture pointer so events don't leak to elements underneath (e.g. Vue DevTools)
    const el = e.currentTarget as Element
    try {
      el.setPointerCapture(e.pointerId)
      captureTarget = el
    } catch {
      /* capture unavailable — the drag still works via document listeners */
    }
    dragDoc = el.ownerDocument
    dragDoc.addEventListener('pointermove', onResizeMove)
    dragDoc.addEventListener('pointerup', onResizeEnd)
    dragDoc.addEventListener('pointercancel', onResizeEnd)
  }

  return {
    get size() {
      return size
    },
    get resizing() {
      return resizing
    },
    onResizeStart,
    /** Set size directly (for corner resize). Clamps to min/max. */
    _setSize(v: number) {
      size = clamp(v)
    },
    /** Persist current size to localStorage. */
    _save() {
      saveSetting(storageKey, String(size))
    },
  }
}
