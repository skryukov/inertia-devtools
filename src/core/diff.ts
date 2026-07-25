/**
 * Computes a structural diff between two values.
 * Returns a tree of DiffNode entries describing what changed.
 */

import { TOO_DEEP } from './utils'

export type DiffType = 'added' | 'removed' | 'changed' | 'unchanged' | 'nested'

export interface DiffNode {
  type: DiffType
  key: string
  oldValue?: unknown
  newValue?: unknown
  children?: DiffNode[]
}

/**
 * Diff two objects (typically page props), returning a flat-ish tree of changes.
 * Recurses into plain objects and arrays for element-level diffing.
 */
export function diffProps(
  oldObj: Record<string, unknown> | undefined,
  newObj: Record<string, unknown> | undefined,
): DiffNode[] {
  if (!oldObj && !newObj) return []
  if (!oldObj) {
    return Object.entries(newObj!).map(([key, value]) => ({
      type: 'added' as const,
      key,
      newValue: value,
    }))
  }
  if (!newObj) {
    return Object.entries(oldObj).map(([key, value]) => ({
      type: 'removed' as const,
      key,
      oldValue: value,
    }))
  }

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
  const nodes: DiffNode[] = []

  for (const key of allKeys) {
    const inOld = key in oldObj
    const inNew = key in newObj
    const oldVal = oldObj[key]
    const newVal = newObj[key]

    if (!inOld) {
      nodes.push({ type: 'added', key, newValue: newVal })
    } else if (!inNew) {
      nodes.push({ type: 'removed', key, oldValue: oldVal })
    } else {
      nodes.push(diffValues(key, oldVal, newVal))
    }
  }

  // Sort: changes first, then alphabetical
  return nodes.toSorted((a, b) => {
    const order = { added: 0, removed: 1, changed: 2, nested: 3, unchanged: 4 }
    const diff = order[a.type] - order[b.type]
    if (diff !== 0) return diff
    return a.key.localeCompare(b.key)
  })
}

/**
 * Diff two values that both exist under the same key.
 * Recurses into plain objects and arrays.
 */
function diffValues(key: string, oldVal: unknown, newVal: unknown): DiffNode {
  // Depth-truncated captures are unknowable: two '[too deep]' sentinels
  // comparing equal must never report "unchanged" — surface them as changed
  // so the truncation is visible instead of silently wrong.
  if (oldVal === TOO_DEEP || newVal === TOO_DEEP) {
    return { type: 'changed', key, oldValue: oldVal, newValue: newVal }
  }

  if (isPlainObject(oldVal) && isPlainObject(newVal)) {
    const children = diffProps(oldVal as Record<string, unknown>, newVal as Record<string, unknown>)
    const hasChanges = children.some((c) => c.type !== 'unchanged')
    return {
      type: hasChanges ? 'nested' : 'unchanged',
      key,
      newValue: newVal,
      children: hasChanges ? children : undefined,
    }
  }

  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    return diffArrays(key, oldVal, newVal)
  }

  if (!deepEqual(oldVal, newVal)) {
    return { type: 'changed', key, oldValue: oldVal, newValue: newVal }
  }

  return { type: 'unchanged', key, newValue: newVal }
}

/**
 * Diff two arrays element-by-element using index-based comparison.
 * Returns a nested node with children for each index.
 */
function diffArrays(key: string, oldArr: unknown[], newArr: unknown[]): DiffNode {
  const maxLen = Math.max(oldArr.length, newArr.length)
  const children: DiffNode[] = []

  for (let i = 0; i < maxLen; i++) {
    const indexKey = `[${i}]`
    if (i >= oldArr.length) {
      children.push({ type: 'added', key: indexKey, newValue: newArr[i] })
    } else if (i >= newArr.length) {
      children.push({ type: 'removed', key: indexKey, oldValue: oldArr[i] })
    } else {
      children.push(diffValues(indexKey, oldArr[i], newArr[i]))
    }
  }

  // If all children are unchanged, collapse to a single unchanged node
  if (children.every((c) => c.type === 'unchanged')) {
    return { type: 'unchanged', key, newValue: newArr }
  }

  return {
    type: 'nested',
    key,
    newValue: newArr,
    children,
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

/**
 * Cheaply count top-level changed keys between two objects without building a diff tree.
 */
export function countTopLevelChanges(
  oldObj: Record<string, unknown> | undefined,
  newObj: Record<string, unknown> | undefined,
): number {
  if (!oldObj && !newObj) return 0
  if (!oldObj) return Object.keys(newObj!).length
  if (!newObj) return Object.keys(oldObj).length

  let count = 0
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
  for (const key of allKeys) {
    if (!(key in oldObj) || !(key in newObj) || !deepEqual(oldObj[key], newObj[key])) {
      count++
    }
  }
  return count
}

export function deepEqual(a: unknown, b: unknown, seen = new WeakSet()): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false

  if (typeof a === 'object') {
    if (seen.has(a as object) || seen.has(b as object)) return false
    seen.add(a as object)
    seen.add(b as object)
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((val, i) => deepEqual(val, b[i], seen))
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((k) => deepEqual(a[k], b[k], seen))
  }

  return false
}
