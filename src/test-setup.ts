/**
 * jsdom has no `matchMedia`. `stores.svelte.ts` calls it unconditionally at
 * context-creation time (guarded on `typeof window`, which jsdom satisfies), so
 * rendering ANY component that takes the devtools context threw
 * "window.matchMedia is not a function" before its first assertion — which is
 * why the whole reactive layer sat at 0% coverage while looking merely untested.
 *
 * Deliberately a real, minimal implementation rather than a `vi.fn()`: theme
 * resolution reads `.matches` and subscribes with `addEventListener`, and tests
 * need to be able to flip the preference and see the panel follow.
 */
class TestMediaQueryList implements MediaQueryList {
  readonly media: string
  matches = false
  onchange: MediaQueryList['onchange'] = null
  private listeners = new Set<(e: MediaQueryListEvent) => void>()

  constructor(media: string) {
    this.media = media
  }

  addEventListener(_type: 'change', listener: EventListenerOrEventListenerObject): void {
    this.listeners.add(listener as (e: MediaQueryListEvent) => void)
  }

  removeEventListener(_type: 'change', listener: EventListenerOrEventListenerObject): void {
    this.listeners.delete(listener as (e: MediaQueryListEvent) => void)
  }

  /** Test hook: how many subscribers are live, so teardown can be asserted. */
  listenerCount(): number {
    return this.listeners.size
  }

  /** Test hook: flip the preference and notify, the way a real UA would. */
  setMatches(value: boolean): void {
    this.matches = value
    const event = { matches: value, media: this.media } as MediaQueryListEvent
    this.onchange?.(event)
    for (const listener of this.listeners) listener(event)
  }

  // Legacy Safari API surface, part of the lib.dom contract.
  addListener(listener: (e: MediaQueryListEvent) => void): void {
    this.listeners.add(listener)
  }
  removeListener(listener: (e: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener)
  }
  dispatchEvent(): boolean {
    return true
  }
}

const queries = new Map<string, TestMediaQueryList>()

/**
 * Drop every query list and its subscribers. Without this the registry is
 * module-scoped, so contexts created by earlier tests keep their `change`
 * listeners attached and any assertion on subscriber count reads the whole
 * file's history instead of the case under test.
 */
export function resetMediaQueries(): void {
  queries.clear()
}

/** Reach the list a component subscribed to, e.g. to simulate an OS theme change. */
export function mediaQuery(media: string): TestMediaQueryList {
  let mql = queries.get(media)
  if (!mql) {
    mql = new TestMediaQueryList(media)
    queries.set(media, mql)
  }
  return mql
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (media: string) => mediaQuery(media)
}
