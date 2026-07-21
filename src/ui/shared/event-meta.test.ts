import { describe, it, expect } from 'vitest'
import { eventCategory, eventColor } from './event-meta'

describe('eventCategory', () => {
  it('classifies lifecycle events', () => {
    expect(eventCategory('inertia:before')).toBe('lifecycle')
    expect(eventCategory('inertia:start')).toBe('lifecycle')
    expect(eventCategory('inertia:finish')).toBe('lifecycle')
  })

  it('classifies navigation events (beforeUpdate no longer swallowed by "before")', () => {
    expect(eventCategory('inertia:beforeUpdate')).toBe('navigation')
    expect(eventCategory('inertia:navigate')).toBe('navigation')
    expect(eventCategory('inertia:clientVisit')).toBe('navigation')
    expect(eventCategory('inertia:location')).toBe('navigation')
  })

  it('classifies outcome events including networkError', () => {
    expect(eventCategory('inertia:success')).toBe('outcome')
    expect(eventCategory('inertia:error')).toBe('outcome')
    expect(eventCategory('inertia:httpException')).toBe('outcome')
    expect(eventCategory('inertia:networkError')).toBe('outcome')
  })

  it('leaves the rest in other', () => {
    expect(eventCategory('inertia:progress')).toBe('other')
    expect(eventCategory('inertia:flash')).toBe('other')
    expect(eventCategory('inertia:prefetching')).toBe('other')
    expect(eventCategory('inertia:prefetched')).toBe('other')
  })

  it('falls back to other for unknown names', () => {
    expect(eventCategory('inertia:futureEvent')).toBe('other')
  })
})

describe('eventColor', () => {
  it('colors all exception events red', () => {
    expect(eventColor('inertia:error')).toBe('var(--dt-red)')
    expect(eventColor('inertia:httpException')).toBe('var(--dt-red)')
    expect(eventColor('inertia:networkError')).toBe('var(--dt-red)')
  })

  it('colors clientVisit with the accent color', () => {
    expect(eventColor('inertia:clientVisit')).toBe('var(--dt-accent)')
  })

  it('falls back to muted for unknown names', () => {
    expect(eventColor('inertia:futureEvent')).toBe('var(--dt-text-muted)')
  })
})
