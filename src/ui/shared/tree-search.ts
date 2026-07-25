/**
 * Search across a props tree by key or primitive value.
 *
 * Paths use dot/bracket notation mirroring TreeView's recursion:
 * `user.name`, `items[2].id`. TreeView builds the same paths via
 * {@link childPath} so search results map 1:1 onto rendered nodes.
 */

export interface TreeSearchResult {
  /** Paths of nodes whose key or stringified primitive value matches the query. */
  matches: Set<string>
  /** Every ancestor path of a match — expand these to reveal all matches. */
  expand: Set<string>
}

/** Maximum nodes visited per search — keeps huge props objects responsive. */
export const MAX_SEARCH_NODES = 10_000

/** Build a child path: `user` + `name` → `user.name`, `items` + `2` → `items[2]`. */
export function childPath(parent: string, key: string, inArray: boolean): string {
  if (inArray) return `${parent}[${key}]`
  return parent ? `${parent}.${key}` : key
}

/** Stringified form of a primitive for value matching; null for objects/arrays. */
function primitiveText(value: unknown): string | null {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'boolean':
      return String(value)
    case 'undefined':
      return 'undefined'
    default:
      return null
  }
}

/**
 * Walk `value` and collect paths matching `query` case-insensitively.
 * A node matches when its key or its stringified primitive value contains
 * the query. Empty/whitespace queries return empty sets.
 */
export function searchPaths(value: unknown, query: string, limit: number = MAX_SEARCH_NODES): TreeSearchResult {
  const matches = new Set<string>()
  const expand = new Set<string>()
  const q = query.trim().toLowerCase()
  if (!q) return { matches, expand }

  let budget = limit
  const ancestors: string[] = []

  function visit(node: unknown, path: string): void {
    const isArray = Array.isArray(node)
    const entries = isArray
      ? (node as unknown[]).map((v, i) => [String(i), v] as const)
      : node !== null && typeof node === 'object'
        ? Object.entries(node as Record<string, unknown>)
        : []

    for (const [key, child] of entries) {
      if (budget-- <= 0) return
      const p = childPath(path, key, isArray)
      const text = primitiveText(child)
      const keyHit = key.toLowerCase().includes(q)
      const valueHit = text !== null && text.toLowerCase().includes(q)
      if (keyHit || valueHit) {
        matches.add(p)
        for (const a of ancestors) expand.add(a)
      }
      if (text === null) {
        ancestors.push(p)
        visit(child, p)
        ancestors.pop()
      }
    }
  }

  visit(value, '')
  return { matches, expand }
}
