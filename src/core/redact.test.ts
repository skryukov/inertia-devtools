import { describe, it, expect } from 'vitest'
import { REDACTED, isSensitiveKey, redactHeaders, redactDeep } from './redact'

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
