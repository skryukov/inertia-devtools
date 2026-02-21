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

  function onResizeEnd(e: PointerEvent) {
    if (!resizing) return
    resizing = false
    if (captureTarget) {
      captureTarget.releasePointerCapture(e.pointerId)
      captureTarget = null
    }
    document.removeEventListener('pointermove', onResizeMove)
    document.removeEventListener('pointerup', onResizeEnd)
    saveSetting(storageKey, String(size))
  }

  function onResizeStart(e: PointerEvent) {
    resizing = true
    startPos = axis === 'x' ? e.clientX : e.clientY
    startSize = size
    // Capture pointer so events don't leak to elements underneath (e.g. Vue DevTools)
    const el = e.currentTarget as Element
    el.setPointerCapture(e.pointerId)
    captureTarget = el
    document.addEventListener('pointermove', onResizeMove)
    document.addEventListener('pointerup', onResizeEnd)
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
