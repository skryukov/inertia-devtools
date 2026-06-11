import type { Page } from '@inertiajs/core'

/**
 * Relaxed version of @inertiajs/core's Page type.
 * Uses looser field types for forward compatibility with future Inertia versions
 * and to simplify test mocks (core's Page requires all fields).
 */
export type InertiaPage = Pick<Page, 'component' | 'url' | 'version' | 'clearHistory' | 'encryptHistory'> & {
  props: Record<string, unknown>
  deferredProps?: Record<string, string[]>
  initialDeferredProps?: Record<string, string[]>
  mergeProps?: string[]
  prependProps?: string[]
  deepMergeProps?: string[]
  matchPropsOn?: string[]
  scrollProps?: Record<string, unknown>
  flash: Record<string, unknown>
  onceProps?: Record<string, { prop: string; expiresAt?: number | null }>
  rememberedState?: Record<string, unknown>
  [key: string]: unknown
}

export const INERTIA_DOM_EVENTS = [
  'inertia:before',
  'inertia:start',
  'inertia:progress',
  'inertia:success',
  'inertia:error',
  'inertia:httpException', // non-Inertia response (4xx/5xx)
  'inertia:networkError', // network/JS error
  'inertia:finish',
  'inertia:beforeUpdate',
  'inertia:navigate',
  'inertia:clientVisit', // router.push/replace/replaceProp/appendToProp/prependToProp
  'inertia:flash',
  'inertia:prefetching',
  'inertia:prefetched',
] as const

export type InertiaEventName = (typeof INERTIA_DOM_EVENTS)[number]
