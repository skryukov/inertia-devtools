import { describe, it, expect } from 'vitest'
import { formatScalar, inlineValue, jsonByteSize, formatBytes } from './format'

describe('formatScalar', () => {
  it('formats null', () => {
    expect(formatScalar(null)).toBe('null')
  })

  it('formats undefined', () => {
    expect(formatScalar(undefined)).toBe('undefined')
  })

  it('formats short strings with quotes', () => {
    expect(formatScalar('hello')).toBe('"hello"')
  })

  it('truncates long strings', () => {
    const long = 'a'.repeat(50)
    expect(formatScalar(long)).toBe(`"${'a'.repeat(30)}..."`)
  })

  it('respects custom maxLen', () => {
    expect(formatScalar('abcdefgh', 5)).toBe('"abcde..."')
  })

  it('does not truncate strings at exactly maxLen', () => {
    expect(formatScalar('abc', 3)).toBe('"abc"')
  })

  it('formats booleans', () => {
    expect(formatScalar(true)).toBe('true')
    expect(formatScalar(false)).toBe('false')
  })

  it('formats numbers', () => {
    expect(formatScalar(42)).toBe('42')
    expect(formatScalar(0)).toBe('0')
    expect(formatScalar(-3.14)).toBe('-3.14')
  })

  it('formats arrays as Array(n)', () => {
    expect(formatScalar([1, 2, 3])).toBe('Array(3)')
    expect(formatScalar([])).toBe('Array(0)')
  })

  it('formats objects as {...}', () => {
    expect(formatScalar({ a: 1 })).toBe('{...}')
  })
})

describe('inlineValue', () => {
  it('formats null', () => {
    expect(inlineValue(null)).toBe('null')
  })

  it('formats undefined', () => {
    expect(inlineValue(undefined)).toBe('undefined')
  })

  it('formats short strings with quotes', () => {
    expect(inlineValue('hi')).toBe('"hi"')
  })

  it('truncates long strings with ellipsis character', () => {
    const long = 'x'.repeat(50)
    const result = inlineValue(long)
    expect(result).toBe(`"${'x'.repeat(40)}\u2026"`)
  })

  it('formats booleans and numbers', () => {
    expect(inlineValue(true)).toBe('true')
    expect(inlineValue(99)).toBe('99')
  })

  it('formats empty array as []', () => {
    expect(inlineValue([])).toBe('[]')
  })

  it('formats non-empty array as Array(n)', () => {
    expect(inlineValue([1, 2])).toBe('Array(2)')
  })

  it('formats empty object as {}', () => {
    expect(inlineValue({})).toBe('{}')
  })

  it('formats small objects with key-value pairs', () => {
    const result = inlineValue({ name: 'Alice', age: 30 })
    expect(result).toBe('{name: "Alice", age: 30}')
  })

  it('truncates objects with more than 3 keys', () => {
    const result = inlineValue({ a: 1, b: 2, c: 3, d: 4 })
    expect(result).toBe('{a: 1, b: 2, c: 3, \u2026}')
  })

  it('shows exactly 3 keys without ellipsis', () => {
    const result = inlineValue({ a: 1, b: 2, c: 3 })
    expect(result).toBe('{a: 1, b: 2, c: 3}')
  })

  it('uses formatScalar for nested values', () => {
    const result = inlineValue({ items: [1, 2, 3] })
    expect(result).toBe('{items: Array(3)}')
  })
})

describe('jsonByteSize', () => {
  it('returns length of JSON string', () => {
    expect(jsonByteSize({ name: 'Alice' })).toBe('{"name":"Alice"}'.length)
  })

  it('returns 0 for circular references', () => {
    const obj: Record<string, unknown> = {}
    obj.self = obj
    expect(jsonByteSize(obj)).toBe(0)
  })

  it('handles arrays', () => {
    expect(jsonByteSize([1, 2, 3])).toBe('[1,2,3]'.length)
  })
})

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(100)).toBe('100 B')
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })
})
