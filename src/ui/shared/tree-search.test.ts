import { describe, it, expect } from 'vitest'
import { searchPaths, childPath } from './tree-search'

describe('childPath', () => {
  it('joins object keys with dots', () => {
    expect(childPath('', 'user', false)).toBe('user')
    expect(childPath('user', 'name', false)).toBe('user.name')
  })

  it('joins array indices with brackets', () => {
    expect(childPath('items', '2', true)).toBe('items[2]')
    expect(childPath('items[2]', 'id', false)).toBe('items[2].id')
  })
})

describe('searchPaths', () => {
  it('returns empty sets for an empty query', () => {
    const { matches, expand } = searchPaths({ user: 'Alice' }, '')
    expect(matches.size).toBe(0)
    expect(expand.size).toBe(0)
  })

  it('returns empty sets for a whitespace-only query', () => {
    const { matches, expand } = searchPaths({ user: 'Alice' }, '   ')
    expect(matches.size).toBe(0)
    expect(expand.size).toBe(0)
  })

  it('matches top-level keys', () => {
    const { matches, expand } = searchPaths({ user: 1, other: 2 }, 'user')
    expect([...matches]).toEqual(['user'])
    expect(expand.size).toBe(0)
  })

  it('matches stringified primitive values', () => {
    const { matches } = searchPaths({ name: 'Alice', flag: true, count: 42, missing: null }, 'alice')
    expect([...matches]).toEqual(['name'])
    expect(searchPaths({ flag: true }, 'true').matches.has('flag')).toBe(true)
    expect(searchPaths({ count: 42 }, '42').matches.has('count')).toBe(true)
    expect(searchPaths({ missing: null }, 'null').matches.has('missing')).toBe(true)
  })

  it('builds nested dot paths and collects ancestors', () => {
    const { matches, expand } = searchPaths({ user: { profile: { name: 'Alice' } } }, 'alice')
    expect([...matches]).toEqual(['user.profile.name'])
    expect([...expand].toSorted()).toEqual(['user', 'user.profile'])
  })

  it('builds array index paths', () => {
    const { matches, expand } = searchPaths({ items: [{ id: 1 }, { id: 42 }] }, '42')
    expect([...matches]).toEqual(['items[1].id'])
    expect([...expand].toSorted()).toEqual(['items', 'items[1]'])
  })

  it('matches keys of expandable nodes without expanding the node itself', () => {
    const { matches, expand } = searchPaths({ user: { name: 'Alice' } }, 'user')
    expect([...matches]).toEqual(['user'])
    expect(expand.has('user')).toBe(false)
  })

  it('is case-insensitive for keys and values', () => {
    expect(searchPaths({ UserName: 1 }, 'username').matches.has('UserName')).toBe(true)
    expect(searchPaths({ name: 'alice' }, 'ALICE').matches.has('name')).toBe(true)
  })

  it('collects every match, not just the first', () => {
    const { matches } = searchPaths({ user: { name: 'Alice' }, author: { name: 'Bob' } }, 'name')
    expect([...matches].toSorted()).toEqual(['author.name', 'user.name'])
  })

  it('stops visiting once the node cap is reached', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    // Cap of 10: visits `items` plus the first 9 elements — never reaches 19
    const { matches } = searchPaths({ items }, '19', 10)
    expect(matches.size).toBe(0)
  })

  it('still returns matches found within the cap', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const { matches } = searchPaths({ items }, '5', 10)
    expect(matches.has('items[5]')).toBe(true)
  })

  it('finds deep matches under the default cap', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const { matches } = searchPaths({ items }, '19')
    expect(matches.has('items[19]')).toBe(true)
  })
})
