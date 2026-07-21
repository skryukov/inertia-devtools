/**
 * Map feature type to its CSS color variable.
 */
export function featureColor(type: string): string {
  switch (type) {
    case 'partial':
      return 'var(--dt-blue)'
    case 'deferred':
      return 'var(--dt-purple)'
    case 'merge':
    case 'deep-merge':
    case 'prepend':
      return 'var(--dt-teal)'
    case 'scroll':
      return 'var(--dt-amber)'
    case 'remember':
      return 'var(--dt-cyan)'
    case 'encrypted':
      return 'var(--dt-red)'
    case 'clear-history':
      return 'var(--dt-amber)'
    case 'prefetch':
      return 'var(--dt-cyan)'
    case 'poll':
      return 'var(--dt-teal)'
    case 'flash':
      return 'var(--dt-amber)'
    case 'once':
      return 'var(--dt-blue)'
    default:
      return 'var(--dt-text-muted)'
  }
}
