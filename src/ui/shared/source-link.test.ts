import { describe, it, expect, vi, afterEach } from 'vitest'
import { openComponentSource } from './source-link'

/** Minimal Response stand-in so the test needs no global fetch/Response. */
const fakeRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

afterEach(() => vi.unstubAllGlobals())

describe('openComponentSource', () => {
  it('reports the opened file name on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeRes(200, { resolved: '/app/src/pages/Users.tsx' })),
    )
    const result = await openComponentSource('Users')
    expect(result.ok).toBe(true)
    expect(result.message).toContain('Users.tsx')
  })

  it('reports "not found" on 404 (feature is on; this name has no file)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeRes(404, { resolved: null })),
    )
    expect(await openComponentSource('Nope')).toEqual({ ok: false, message: 'No source file found for Nope' })
  })

  it('never throws into the click handler on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      }),
    )
    expect(await openComponentSource('Users')).toEqual({ ok: false, message: 'Source links unavailable' })
  })

  it('url-encodes the component name and POSTs (never a state-changing GET)', async () => {
    const spy = vi.fn(async () => fakeRes(200, {}))
    vi.stubGlobal('fetch', spy)
    await openComponentSource('admin/Index')
    expect(spy).toHaveBeenCalledWith('/__inertia-devtools/open?component=admin%2FIndex', { method: 'POST' })
  })

  it('short-circuits an empty component without a request', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect((await openComponentSource('')).ok).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})
