<script lang="ts">
  import type { DevToolsContext } from './stores.svelte'
  import { loadSetting, saveSetting } from './shared/storage'

  let { ctx }: { ctx: DevToolsContext } = $props()

  // Draggable position
  let pos = $state({ x: 16, y: 16 })
  let dragging = $state(false)
  let dragOffset = { x: 0, y: 0 }

  // Status effect
  type StatusEffect = 'idle' | 'active' | 'success' | 'redirect' | 'error' | 'prefetch'
  let statusEffect = $state<StatusEffect>('idle')
  let pulsing = $state(false)
  let effectTimeout: ReturnType<typeof setTimeout> | null = null
  let prevEffect: StatusEffect = 'idle'

  // Restore position from localStorage
  {
    const saved = loadSetting('trigger-pos', '')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        pos = { x: parsed.x ?? 16, y: parsed.y ?? 16 }
      } catch {
        /* ignore */
      }
    }
  }

  // Watch latest request for status effects.
  // Read tick to ensure re-evaluation when records are mutated in place.
  $effect(() => {
    void ctx.state.tick
    const latest = ctx.latestRequest
    if (!latest) return

    if (!latest.finishedAt) {
      setEffect('active')
    } else if (latest.type === 'prefetch') {
      setEffect('prefetch')
    } else if (latest.status && latest.status >= 400) {
      setEffect('error')
    } else if (latest.status && latest.status >= 300) {
      setEffect('redirect')
    } else {
      setEffect('success')
    }

    return () => {
      if (effectTimeout) clearTimeout(effectTimeout)
    }
  })

  function setEffect(effect: StatusEffect) {
    if (effect === prevEffect) return
    prevEffect = effect
    statusEffect = effect
    if (effectTimeout) clearTimeout(effectTimeout)

    if (effect !== 'idle' && effect !== 'active') {
      // Re-trigger pulse by toggling the class off/on
      pulsing = false
      requestAnimationFrame(() => {
        pulsing = true
      })

      effectTimeout = setTimeout(() => {
        prevEffect = 'idle'
        statusEffect = 'idle'
        pulsing = false
      }, 1500)
    }
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    pos = {
      x: Math.max(0, Math.min(vw - 36, vw - (e.clientX - dragOffset.x + 36))),
      y: Math.max(0, Math.min(vh - 36, vh - (e.clientY - dragOffset.y + 36))),
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return
    dragging = false

    saveSetting('trigger-pos', JSON.stringify(pos))

    // Detect click (no significant drag)
    const el = e.currentTarget as HTMLElement
    el.releasePointerCapture(e.pointerId)
  }

  function onClick() {
    if (dragging) return
    ctx.togglePanel()
  }

  const effectColor = $derived.by(() => {
    switch (statusEffect) {
      case 'success':
        return 'var(--dt-green)'
      case 'redirect':
        return 'var(--dt-amber)'
      case 'error':
        return 'var(--dt-red)'
      case 'prefetch':
        return 'var(--dt-cyan)'
      case 'active':
        return 'var(--dt-accent)'
      default:
        return 'transparent'
    }
  })
</script>

<button
  class="trigger"
  class:active={statusEffect === 'active'}
  class:pulse={pulsing}
  class:panel-open={ctx.panelOpen}
  style:right="{pos.x}px"
  style:bottom="{pos.y}px"
  style:--effect-color={effectColor}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onclick={onClick}
  aria-label="Toggle Inertia DevTools (Alt+Shift+D)"
  title="Inertia DevTools (Alt+Shift+D)"
>
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M4 4L9 9L4 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M9 4L14 9L9 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</button>

<style>
  .trigger {
    position: fixed;
    pointer-events: auto;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--dt-bg-card);
    border: 1px solid var(--dt-border);
    color: var(--dt-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      color 0.2s,
      border-color 0.2s,
      box-shadow 0.2s;
    box-shadow: 0 0 0 0 var(--effect-color, transparent);
    touch-action: none;
    user-select: none;
    z-index: 2147483647;
  }

  .trigger:hover {
    color: var(--dt-text);
    border-color: var(--dt-accent);
  }

  .trigger.panel-open {
    color: var(--dt-accent);
    border-color: var(--dt-accent);
  }

  .trigger.active {
    animation: orbit 1s linear infinite;
  }

  /* Status effect pulse — toggled via class to re-trigger on each navigation */
  .trigger.pulse {
    animation: pulse 0.6s ease-out;
  }

  @keyframes orbit {
    0% {
      box-shadow: 0 0 0 0 var(--effect-color);
    }
    50% {
      box-shadow: 0 0 0 4px var(--effect-color);
    }
    100% {
      box-shadow: 0 0 0 0 var(--effect-color);
    }
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 var(--effect-color);
    }
    100% {
      box-shadow: 0 0 0 8px transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .trigger,
    .trigger.active {
      animation: none;
    }
  }
</style>
