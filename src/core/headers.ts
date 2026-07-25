/**
 * HTTP header display helpers shared by the Network tab and markdown export.
 */

export interface HeaderEntry {
  name: string
  value: string
}

export const isInertiaHeader = (name: string) => name.toLowerCase().startsWith('x-inertia')

/** Sort headers for display: X-Inertia-* first, then alphabetical. */
export function sortedHeaders(headers: Record<string, string> | undefined): HeaderEntry[] {
  if (!headers) return []
  const entries = Object.entries(headers).map(([name, value]) => ({ name, value }))
  return entries.toSorted((a, b) => {
    const ai = isInertiaHeader(a.name)
    const bi = isInertiaHeader(b.name)
    if (ai !== bi) return ai ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
