import type { InertiaPage } from './protocol'
import type { ActiveFeature, RequestRecord } from './types'
import { isNonEmptyRecord } from '../ui/shared/storage'

/**
 * Extract page-level Inertia features from a page object.
 * These features depend only on page properties (deferred props, merge
 * strategies, encryption, flash, etc.) and do NOT require a RequestRecord.
 */
export function extractPageFeatures(page: InertiaPage): ActiveFeature[] {
  const features: ActiveFeature[] = []

  // Deferred props — check both pending (deferredProps) and original (initialDeferredProps)
  const deferredGroups = isNonEmptyRecord(page.deferredProps)
    ? page.deferredProps
    : isNonEmptyRecord(page.initialDeferredProps)
      ? page.initialDeferredProps
      : null
  if (deferredGroups) {
    features.push({
      type: 'deferred',
      label: 'DEFERRED',
      details: { groups: deferredGroups },
    })
  }

  // Merge strategies
  if (page.mergeProps?.length) {
    features.push({
      type: 'merge',
      label: 'MERGE',
      details: { props: page.mergeProps },
    })
  }
  if (page.prependProps?.length) {
    features.push({
      type: 'prepend',
      label: 'PREPEND',
      details: { props: page.prependProps },
    })
  }
  if (page.deepMergeProps?.length) {
    features.push({
      type: 'deep-merge',
      label: 'DEEP MERGE',
      details: { props: page.deepMergeProps },
    })
  }

  // Scroll props
  if (isNonEmptyRecord(page.scrollProps)) {
    features.push({
      type: 'scroll',
      label: 'SCROLL',
      details: { props: page.scrollProps },
    })
  }

  // Once props
  if (isNonEmptyRecord(page.onceProps)) {
    features.push({
      type: 'once',
      label: 'ONCE',
      details: { props: page.onceProps },
    })
  }

  // Encrypted history
  if (page.encryptHistory) {
    features.push({ type: 'encrypted', label: 'ENCRYPTED' })
  }

  // Clear history
  if (page.clearHistory) {
    features.push({ type: 'clear-history', label: 'CLEAR HISTORY' })
  }

  // Flash
  if (isNonEmptyRecord(page.flash)) {
    features.push({
      type: 'flash',
      label: 'FLASH',
      details: { flash: page.flash },
    })
  }

  // Remembered state
  if (isNonEmptyRecord(page.rememberedState)) {
    features.push({
      type: 'remember',
      label: 'REMEMBER',
      details: { keys: Object.keys(page.rememberedState) },
    })
  }

  return features
}

/**
 * Extract active Inertia features from a request record and its page object.
 * Combines request-specific features (partial, prefetch, cached) with
 * page-level features extracted by extractPageFeatures.
 */
export function extractFeatures(record: RequestRecord, page: InertiaPage): ActiveFeature[] {
  const features: ActiveFeature[] = []

  // Request-specific: Partial reload
  if (record.type === 'partial') {
    features.push({ type: 'partial', label: 'PARTIAL' })
  }

  // Page-level features
  features.push(...extractPageFeatures(page))

  // Request-specific: Prefetch
  if (record.type === 'prefetch') {
    features.push({ type: 'prefetch', label: 'PREFETCH' })
  }

  // Request-specific: Cached prefetch (navigation that used prefetched data — no XHR start/finish)
  const hasStart = record.events.some((e) => e.name === 'inertia:start')
  if (!hasStart && record.startedAt > 0 && record.type !== 'client') {
    features.push({ type: 'cached', label: 'CACHED' })
  }

  return features
}
