import type { InertiaEventName } from '../../core/protocol'

/**
 * Display metadata for the Events tab, keyed explicitly per event name —
 * substring matching misclassified networkError/beforeUpdate/clientVisit.
 */

export type EventCategory = 'lifecycle' | 'navigation' | 'outcome' | 'other'

interface EventMeta {
  category: EventCategory
  color: string
}

const EVENT_META: Record<InertiaEventName, EventMeta> = {
  'inertia:before': { category: 'lifecycle', color: 'var(--dt-blue)' },
  'inertia:start': { category: 'lifecycle', color: 'var(--dt-blue)' },
  'inertia:finish': { category: 'lifecycle', color: 'var(--dt-green)' },
  'inertia:progress': { category: 'other', color: 'var(--dt-teal)' },
  'inertia:success': { category: 'outcome', color: 'var(--dt-green)' },
  'inertia:error': { category: 'outcome', color: 'var(--dt-red)' },
  'inertia:httpException': { category: 'outcome', color: 'var(--dt-red)' },
  'inertia:networkError': { category: 'outcome', color: 'var(--dt-red)' },
  'inertia:location': { category: 'navigation', color: 'var(--dt-amber)' },
  'inertia:beforeUpdate': { category: 'navigation', color: 'var(--dt-accent)' },
  'inertia:navigate': { category: 'navigation', color: 'var(--dt-accent)' },
  'inertia:clientVisit': { category: 'navigation', color: 'var(--dt-accent)' },
  'inertia:flash': { category: 'other', color: 'var(--dt-text-muted)' },
  'inertia:prefetching': { category: 'other', color: 'var(--dt-cyan)' },
  'inertia:prefetched': { category: 'other', color: 'var(--dt-cyan)' },
}

export function eventCategory(name: string): EventCategory {
  return EVENT_META[name as InertiaEventName]?.category ?? 'other'
}

export function eventColor(name: string): string {
  return EVENT_META[name as InertiaEventName]?.color ?? 'var(--dt-text-muted)'
}
