import { describe, it, expect } from 'vitest'
import { REDACTED, isSensitiveKey, redactHeaders, redactDeep, redactExport, redactUrl } from './redact'

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'Password',
    'password_confirmation',
    'passwd',
    'pwd',
    'client_secret',
    'token',
    'X-CSRF-Token',
    'X-XSRF-TOKEN',
    'Authorization',
    'Cookie',
    'api_key',
    'apiKey',
    'access-key',
    'private_key',
    'credentials',
    'session_id',
  ])('matches %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true)
  })

  // The point of spelling out `authorization` instead of `auth`: these are
  // ordinary props and headers that must stay readable.
  it.each([
    'author',
    'authors',
    'authored_at',
    'email',
    'name',
    'X-Inertia',
    'X-Inertia-Version',
    'X-Requested-With',
    'Accept',
    'Content-Type',
    'session_count',
  ])('does not match %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false)
  })
})

describe('redactHeaders', () => {
  it('masks credentials and keeps protocol headers readable', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer JWT-SECRET',
        'X-CSRF-Token': 'csrf-abc123',
        'X-Inertia': 'true',
        'X-Inertia-Version': 'v1',
      }),
    ).toEqual({
      Authorization: REDACTED,
      'X-CSRF-Token': REDACTED,
      'X-Inertia': 'true',
      'X-Inertia-Version': 'v1',
    })
  })

  it('preserves non-string values on non-sensitive keys', () => {
    expect(redactHeaders({ 'X-Inertia': true, Cookie: 'a=b' })).toEqual({ 'X-Inertia': true, Cookie: REDACTED })
  })

  it('returns a copy rather than mutating the input', () => {
    const input = { Authorization: 'Bearer x' }
    expect(redactHeaders(input)).not.toBe(input)
    expect(input.Authorization).toBe('Bearer x')
  })

  it('handles an empty map', () => {
    expect(redactHeaders({})).toEqual({})
  })
})

describe('redactDeep', () => {
  it('masks a login body while keeping its shape', () => {
    expect(redactDeep({ email: 'ada@example.com', password: 'hunter2' })).toEqual({
      email: 'ada@example.com',
      password: REDACTED,
    })
  })

  it('masks nested and array-nested credentials', () => {
    expect(
      redactDeep({
        user: { name: 'Ada', api_key: 'k-1' },
        accounts: [{ token: 't-1' }, { token: 't-2' }],
      }),
    ).toEqual({
      user: { name: 'Ada', api_key: REDACTED },
      accounts: [{ token: REDACTED }, { token: REDACTED }],
    })
  })

  it('leaves an author prop alone', () => {
    expect(redactDeep({ post: { title: 'Hi', author: 'Ada' } })).toEqual({ post: { title: 'Hi', author: 'Ada' } })
  })

  it('redacts a whole subtree when the key itself is sensitive', () => {
    expect(redactDeep({ credentials: { user: 'a', pass: 'b' } })).toEqual({ credentials: REDACTED })
  })

  it('passes through primitives and null', () => {
    expect(redactDeep('plain')).toBe('plain')
    expect(redactDeep(42)).toBe(42)
    expect(redactDeep(null)).toBe(null)
    expect(redactDeep(undefined)).toBe(undefined)
  })

  it('redacts class instances, which JSON.stringify serializes regardless', () => {
    // A form model or Precognition object is not a plain object, so a
    // prototype check skipped it — while JSON.stringify happily wrote its
    // own properties into the export.
    class LoginForm {
      email = 'ada@example.com'
      password = 'LEAK-CLASS'
    }
    const out = JSON.stringify(redactDeep(new LoginForm()))
    expect(out).not.toContain('LEAK-CLASS')
    expect(out).toContain('ada@example.com')
  })

  it('passes host objects through untouched', () => {
    const file = new File(['x'], 'a.txt')
    const form = new FormData()
    expect(redactDeep(file)).toBe(file)
    expect(redactDeep(form)).toBe(form)
    expect(redactDeep({ upload: file })).toEqual({ upload: file })
  })

  it('stops at the depth limit instead of recursing forever', () => {
    // A cycle would hang an unbounded walk; the limit must bound it.
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic
    expect(() => redactDeep(cyclic)).not.toThrow()
  })

  it('does not mutate the input', () => {
    const input = { password: 'hunter2', nested: { token: 't' } }
    const out = redactDeep(input) as Record<string, unknown>
    expect(out.password).toBe(REDACTED)
    expect(input.password).toBe('hunter2')
    expect(input.nested.token).toBe('t')
  })
})

describe('redactExport', () => {
  it('has no depth cap, unlike the capture-path walker', () => {
    // redactDeep bails at depth 8 and returns the raw subtree — fail-open,
    // acceptable on a hot path, wrong at an export boundary.
    let deep: Record<string, unknown> = { api_token: 'LEAK' }
    for (let i = 0; i < 15; i++) deep = { nest: deep }

    expect(JSON.stringify(redactDeep(deep))).toContain('LEAK')
    expect(JSON.stringify(redactExport(deep))).not.toContain('LEAK')
  })

  it('survives a cycle instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { name: 'root', token: 'LEAK' }
    cyclic.self = cyclic
    const out = JSON.stringify(redactExport(cyclic))
    expect(out).not.toContain('LEAK')
    expect(out).toContain('[Circular]')
  })

  it('exports a shared reference twice instead of calling it a cycle', () => {
    // The cycle guard used to mark every object it had EVER seen, not the ones
    // on the current path — so ordinary aliasing (one user object shared across
    // two props, a lookup table referenced from several rows) exported as
    // '[Circular]' and the data was silently lost.
    const user = { name: 'Ada', email: 'ada@example.com' }
    const out = redactExport({ author: user, editor: user })

    expect(out).toEqual({ author: user, editor: user })
    expect(JSON.stringify(out)).not.toContain('[Circular]')
  })

  it('still redacts through the second path to a shared object', () => {
    const creds = { api_key: 'LEAK', label: 'primary' }
    const out = JSON.stringify(redactExport({ a: creds, b: creds }))
    expect(out).not.toContain('LEAK')
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2)
  })

  it('keeps the structure and the harmless values', () => {
    expect(redactExport({ users: [{ name: 'Ada' }], csrf_token: 'LEAK' })).toEqual({
      users: [{ name: 'Ada' }],
      csrf_token: REDACTED,
    })
  })

  it('does not mutate the input', () => {
    const input = { csrf_token: 'keep-me' }
    redactExport(input)
    expect(input.csrf_token).toBe('keep-me')
  })
})

describe('redaction of non-plain objects', () => {
  class Creds {
    user = 'ada'
    api_token = 'LEAK-INSTANCE'
  }

  it('redactExport reaches into class instances too', () => {
    const out = JSON.stringify(redactExport({ form: new Creds() }))
    expect(out).not.toContain('LEAK-INSTANCE')
    expect(out).toContain('ada')
  })

  it('leaves opaque types alone rather than mangling them', () => {
    const date = new Date(0)
    expect(redactExport({ at: date }).at).toBe(date)
    const map = new Map([['token', 'x']])
    expect(redactExport({ m: map }).m).toBe(map)
  })
})

describe('redactUrl', () => {
  it('masks the value and keeps the parameter name', () => {
    // Seeing that a `?reset_token=` was present is the debuggable part; its
    // value is the part that must not reach a GitHub issue.
    expect(redactUrl('/reset?reset_token=abc123&page=2')).toBe(
      `/reset?reset_token=${encodeURIComponent(REDACTED)}&page=2`,
    )
  })

  it('leaves harmless query strings byte-identical', () => {
    // Returning early matters: round-tripping through URL re-encodes and
    // reorders, so an untouched URL must never go through it.
    const url = '/users?page=2&sort=name&q=a+b%20c'
    expect(redactUrl(url)).toBe(url)
  })

  it('leaves a URL with no query string alone', () => {
    expect(redactUrl('/users/1')).toBe('/users/1')
  })

  it('preserves relative vs absolute form', () => {
    expect(redactUrl('/cb?access_key=k')).toMatch(/^\/cb\?/)
    expect(redactUrl('https://api.example.com/cb?access_key=k')).toMatch(/^https:\/\/api\.example\.com\/cb\?/)
  })

  it('returns an unparseable URL untouched rather than mangling it', () => {
    const junk = 'http://[not a url?token=x'
    expect(redactUrl(junk)).toBe(junk)
  })

  it('reaches URLs nested anywhere in an exported record', () => {
    const out = redactExport({
      url: '/a?api_key=LEAK1',
      wire: { request: { url: '/b?csrf_token=LEAK2' } },
      redirectUrl: '/c?password=LEAK3',
    })
    const json = JSON.stringify(out)
    for (const leak of ['LEAK1', 'LEAK2', 'LEAK3']) expect(json).not.toContain(leak)
  })
})
