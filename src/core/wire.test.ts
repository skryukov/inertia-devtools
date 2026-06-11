import { describe, it, expect } from 'vitest'
import { visitUuid, wireBodySize } from './wire'

describe('visitUuid', () => {
  it('returns string ids', () => {
    expect(visitUuid({ id: 'abc' })).toBe('abc')
  })

  it('returns undefined for missing or non-string ids', () => {
    expect(visitUuid(undefined)).toBeUndefined()
    expect(visitUuid({})).toBeUndefined()
    expect(visitUuid({ id: 42 })).toBeUndefined()
  })
})

describe('wireBodySize', () => {
  it('returns UTF-8 byte length for ASCII strings', () => {
    expect(wireBodySize('abc')).toBe(3)
  })

  it('counts multi-byte characters correctly', () => {
    expect(wireBodySize('héllo')).toBe(6) // é = 2 bytes
    expect(wireBodySize('日本')).toBe(6) // 3 bytes each
    expect(wireBodySize('👍')).toBe(4) // surrogate pair
  })

  it('matches TextEncoder for mixed content', () => {
    const sample = '{"name":"héllo 👍 日本"}'
    expect(wireBodySize(sample)).toBe(new TextEncoder().encode(sample).length)
  })

  it('estimates parsed objects via JSON length (prefetched event payloads)', () => {
    expect(wireBodySize({ a: 1 })).toBe('{"a":1}'.length)
  })

  it('returns undefined for null/undefined/primitives', () => {
    expect(wireBodySize(undefined)).toBeUndefined()
    expect(wireBodySize(null)).toBeUndefined()
    expect(wireBodySize(42)).toBeUndefined()
  })
})
