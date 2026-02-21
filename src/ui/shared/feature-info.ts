/**
 * Descriptions and documentation links for Inertia features.
 * Used by feature badge expansion in PageView.
 */
import type { DocsProvider } from '../../core/types'

export interface FeatureInfo {
  description: string
  docsUrl: string
}

interface FeatureDoc {
  description: string
  urls: Record<DocsProvider, string>
}

const featureDocs: Record<string, FeatureDoc> = {
  partial: {
    description: 'Only specific props were requested, reducing response size.',
    urls: {
      inertiajs: 'https://inertiajs.com/partial-reloads',
      'inertia-rails': 'https://inertia-rails.dev/guide/partial-reloads',
    },
  },
  deferred: {
    description: 'Heavy props loaded asynchronously after initial page render.',
    urls: {
      inertiajs: 'https://inertiajs.com/deferred-props',
      'inertia-rails': 'https://inertia-rails.dev/guide/deferred-props',
    },
  },
  merge: {
    description: 'Props merged with existing values instead of replacing.',
    urls: {
      inertiajs: 'https://inertiajs.com/merging-props',
      'inertia-rails': 'https://inertia-rails.dev/guide/merging-props',
    },
  },
  prepend: {
    description: 'New items prepended to existing array.',
    urls: {
      inertiajs: 'https://inertiajs.com/merging-props#prepending-and-appending',
      'inertia-rails': 'https://inertia-rails.dev/guide/merging-props',
    },
  },
  'deep-merge': {
    description: 'Props deep-merged into existing nested structure.',
    urls: {
      inertiajs: 'https://inertiajs.com/merging-props#deep-merging',
      'inertia-rails': 'https://inertia-rails.dev/guide/merging-props',
    },
  },
  scroll: {
    description: 'Scroll position metadata attached to props for infinite scroll.',
    urls: {
      inertiajs: 'https://inertiajs.com/scroll-management',
      'inertia-rails': 'https://inertia-rails.dev/guide/infinite-scroll',
    },
  },
  once: {
    description: 'Props sent only on first visit, skipped on subsequent requests.',
    urls: {
      inertiajs: 'https://inertiajs.com/partial-reloads#lazy-data-evaluation',
      'inertia-rails': 'https://inertia-rails.dev/guide/once-props',
    },
  },
  encrypted: {
    description: 'Page history encrypted for sensitive data protection.',
    urls: {
      inertiajs: 'https://inertiajs.com/history-encryption',
      'inertia-rails': 'https://inertia-rails.dev/guide/history-encryption',
    },
  },
  'clear-history': {
    description: 'Previous history entries cleared when this page loaded.',
    urls: {
      inertiajs: 'https://inertiajs.com/history-encryption#clearing-history',
      'inertia-rails': 'https://inertia-rails.dev/guide/history-encryption',
    },
  },
  prefetch: {
    description: 'Page data prefetched before user navigates.',
    urls: {
      inertiajs: 'https://inertiajs.com/prefetching',
      'inertia-rails': 'https://inertia-rails.dev/guide/prefetching',
    },
  },
  cached: {
    description: 'Navigation used previously prefetched data — no new HTTP request.',
    urls: {
      inertiajs: 'https://inertiajs.com/prefetching',
      'inertia-rails': 'https://inertia-rails.dev/guide/prefetching',
    },
  },
  flash: {
    description: 'Flash messages included in response.',
    urls: {
      inertiajs: 'https://inertiajs.com/shared-data#flash-messages',
      'inertia-rails': 'https://inertia-rails.dev/guide/flash-data',
    },
  },
  remember: {
    description: 'Local component state remembered across navigations.',
    urls: {
      inertiajs: 'https://inertiajs.com/remembering-state',
      'inertia-rails': 'https://inertia-rails.dev/guide/remembering-state',
    },
  },
}

export function getFeatureInfo(type: string, provider: DocsProvider = 'inertiajs'): FeatureInfo | undefined {
  const doc = featureDocs[type]
  if (!doc) return undefined
  return { description: doc.description, docsUrl: doc.urls[provider] }
}
