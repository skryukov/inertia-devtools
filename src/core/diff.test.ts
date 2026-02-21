import { describe, it, expect } from 'vitest'
import { diffProps } from './diff'

describe('diffProps', () => {
  it('returns empty for two undefined inputs', () => {
    expect(diffProps(undefined, undefined)).toEqual([])
  })

  it('marks all keys as added when old is undefined', () => {
    const result = diffProps(undefined, { name: 'Alice', age: 30 })
    expect(result).toHaveLength(2)
    expect(result.every((n) => n.type === 'added')).toBe(true)
    expect(result.find((n) => n.key === 'name')?.newValue).toBe('Alice')
  })

  it('marks all keys as removed when new is undefined', () => {
    const result = diffProps({ name: 'Alice' }, undefined)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('removed')
    expect(result[0].oldValue).toBe('Alice')
  })

  it('detects added keys', () => {
    const result = diffProps({ a: 1 }, { a: 1, b: 2 })
    const added = result.find((n) => n.key === 'b')
    expect(added?.type).toBe('added')
    expect(added?.newValue).toBe(2)
  })

  it('detects removed keys', () => {
    const result = diffProps({ a: 1, b: 2 }, { a: 1 })
    const removed = result.find((n) => n.key === 'b')
    expect(removed?.type).toBe('removed')
    expect(removed?.oldValue).toBe(2)
  })

  it('detects changed values', () => {
    const result = diffProps({ name: 'Alice' }, { name: 'Bob' })
    const changed = result.find((n) => n.key === 'name')
    expect(changed?.type).toBe('changed')
    expect(changed?.oldValue).toBe('Alice')
    expect(changed?.newValue).toBe('Bob')
  })

  it('detects unchanged values', () => {
    const result = diffProps({ a: 1, b: 2 }, { a: 1, b: 2 })
    expect(result.every((n) => n.type === 'unchanged')).toBe(true)
  })

  it('recurses into nested objects', () => {
    const result = diffProps({ user: { name: 'Alice', role: 'admin' } }, { user: { name: 'Bob', role: 'admin' } })
    const userNode = result.find((n) => n.key === 'user')
    expect(userNode?.type).toBe('nested')
    expect(userNode?.children).toHaveLength(2)

    const nameChild = userNode?.children?.find((c) => c.key === 'name')
    expect(nameChild?.type).toBe('changed')
    expect(nameChild?.oldValue).toBe('Alice')
    expect(nameChild?.newValue).toBe('Bob')

    const roleChild = userNode?.children?.find((c) => c.key === 'role')
    expect(roleChild?.type).toBe('unchanged')
  })

  it('marks nested object as unchanged when all children match', () => {
    const result = diffProps({ config: { theme: 'dark' } }, { config: { theme: 'dark' } })
    const configNode = result.find((n) => n.key === 'config')
    expect(configNode?.type).toBe('unchanged')
    expect(configNode?.children).toBeUndefined()
  })

  it('diffs arrays element-by-element showing added items', () => {
    const result = diffProps({ tags: ['a', 'b'] }, { tags: ['a', 'b', 'c'] })
    const tags = result.find((n) => n.key === 'tags')
    expect(tags?.type).toBe('nested')
    expect(tags?.children).toHaveLength(3)

    const added = tags?.children?.find((c) => c.key === '[2]')
    expect(added?.type).toBe('added')
    expect(added?.newValue).toBe('c')

    const unchanged = tags?.children?.filter((c) => c.type === 'unchanged')
    expect(unchanged).toHaveLength(2)
  })

  it('diffs arrays showing removed items', () => {
    const result = diffProps({ items: [1, 2, 3] }, { items: [1] })
    const items = result.find((n) => n.key === 'items')
    expect(items?.type).toBe('nested')
    expect(items?.children).toHaveLength(3)

    const removed = items?.children?.filter((c) => c.type === 'removed')
    expect(removed).toHaveLength(2)
    expect(removed?.[0].key).toBe('[1]')
    expect(removed?.[0].oldValue).toBe(2)
  })

  it('diffs arrays of objects recursively', () => {
    const result = diffProps(
      { users: [{ name: 'Alice' }, { name: 'Bob' }] },
      { users: [{ name: 'Alice' }, { name: 'Carol' }] },
    )
    const users = result.find((n) => n.key === 'users')
    expect(users?.type).toBe('nested')

    const first = users?.children?.find((c) => c.key === '[0]')
    expect(first?.type).toBe('unchanged')

    const second = users?.children?.find((c) => c.key === '[1]')
    expect(second?.type).toBe('nested')
    expect(second?.children?.find((c) => c.key === 'name')?.newValue).toBe('Carol')
  })

  it('treats identical arrays as unchanged', () => {
    const result = diffProps({ items: [1, 2, 3] }, { items: [1, 2, 3] })
    expect(result[0].type).toBe('unchanged')
  })

  it('sorts changes before unchanged', () => {
    const result = diffProps({ a: 1, b: 2, c: 3 }, { a: 1, b: 99, c: 3, d: 4 })
    const types = result.map((n) => n.type)
    // added d, changed b, then unchanged a and c
    expect(types).toEqual(['added', 'changed', 'unchanged', 'unchanged'])
  })

  it('handles type changes (string to number)', () => {
    const result = diffProps({ val: 'hello' }, { val: 42 })
    expect(result[0].type).toBe('changed')
    expect(result[0].oldValue).toBe('hello')
    expect(result[0].newValue).toBe(42)
  })

  it('handles null values', () => {
    const result = diffProps({ a: null }, { a: 'value' })
    expect(result[0].type).toBe('changed')
    expect(result[0].oldValue).toBe(null)
    expect(result[0].newValue).toBe('value')
  })

  it('handles empty objects', () => {
    const result = diffProps({}, {})
    expect(result).toEqual([])
  })
})
