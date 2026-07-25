import { describe, it, expect } from 'vitest'
import { normalizeUrl } from './url'

describe('normalizeUrl', () => {
  it('reduces an absolute URL to path + search', () => {
    expect(normalizeUrl('http://localhost/users?tab=a')).toBe('/users?tab=a')
    expect(normalizeUrl('https://example.com/a/b')).toBe('/a/b')
  })

  it('leaves a relative URL as path + search', () => {
    expect(normalizeUrl('/users?tab=a')).toBe('/users?tab=a')
  })

  it('drops the hash, which never reaches the server', () => {
    expect(normalizeUrl('/users?tab=a#row-3')).toBe('/users?tab=a')
  })

  it('returns garbage unchanged rather than throwing', () => {
    expect(normalizeUrl('http://[bad')).toBe('http://[bad')
  })

  it('is stable across repeat calls now that it is cached', () => {
    // The cache is keyed on the raw string; the same input must keep returning
    // the same answer, and a different input must not pick up a neighbour's.
    for (let i = 0; i < 3; i++) {
      expect(normalizeUrl('http://localhost/a?x=1')).toBe('/a?x=1')
      expect(normalizeUrl('http://localhost/b?x=1')).toBe('/b?x=1')
    }
  })

  it('stays correct after the cache is cleared by overflow', () => {
    // MAX_CACHE is 500 and overflow clears wholesale, so the entry looked up
    // here is evicted mid-loop and has to be recomputed correctly.
    const first = normalizeUrl('http://localhost/first?q=1')
    for (let i = 0; i < 600; i++) normalizeUrl(`http://localhost/filler/${i}`)
    expect(normalizeUrl('http://localhost/first?q=1')).toBe(first)
    expect(first).toBe('/first?q=1')
  })
})
