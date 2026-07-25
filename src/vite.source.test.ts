import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inertiaDevtools, resolveComponentSource, isSameOriginRequest } from './vite'

const INIT_ID = '\0inertia-devtools-init'

/** Run configResolved + load(INIT_ID) with VITEST cleared (so strip is off). */
async function initModuleFor(root: string, options = {}): Promise<string> {
  const plugin = inertiaDevtools(options) as unknown as {
    configResolved(c: { command: 'serve'; mode: string; root: string }): void
    load(this: unknown, id: string): Promise<string | null>
  }
  const previous = process.env.VITEST
  delete process.env.VITEST
  try {
    plugin.configResolved({ command: 'serve', mode: 'development', root })
    const ctx = { resolve: (s: string) => (s === '@inertiajs/core' ? { id: s } : null) }
    return (await plugin.load.call(ctx, INIT_ID)) ?? ''
  } finally {
    if (previous !== undefined) process.env.VITEST = previous
  }
}

/**
 * The source-open endpoint takes a component name straight from the browser and
 * turns it into a file path to hand the editor. The containment guard is the
 * only thing standing between that and `?component=../../../../etc/passwd`, so
 * it is tested directly — including a real escape target proven unreachable.
 */
describe('resolveComponentSource', () => {
  const exts = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte']
  let pagesDir: string

  beforeAll(() => {
    pagesDir = mkdtempSync(join(tmpdir(), 'idt-pages-'))
    writeFileSync(join(pagesDir, 'Users.tsx'), 'export default 1')
    mkdirSync(join(pagesDir, 'admin'), { recursive: true })
    writeFileSync(join(pagesDir, 'admin', 'Index.vue'), 'x')
  })
  afterAll(() => rmSync(pagesDir, { recursive: true, force: true }))

  it('resolves a component name to its file', () => {
    expect(resolveComponentSource(pagesDir, exts, 'Users')).toBe(join(pagesDir, 'Users.tsx'))
  })

  it('resolves a nested (slashed) component name', () => {
    expect(resolveComponentSource(pagesDir, exts, 'admin/Index')).toBe(join(pagesDir, 'admin', 'Index.vue'))
  })

  it('returns null for an unknown component', () => {
    expect(resolveComponentSource(pagesDir, exts, 'Nope')).toBeNull()
  })

  it('returns null for an empty component name', () => {
    expect(resolveComponentSource(pagesDir, exts, '')).toBeNull()
  })

  it('rejects path traversal, even to a file that really exists outside pagesDir', () => {
    // Plant a real file one level above pagesDir and prove the guard keeps the
    // browser from opening it. Remove the containment check and this fails.
    const escapeFile = join(pagesDir, '..', 'idt-escape-target.tsx')
    writeFileSync(escapeFile, 'secret')
    try {
      expect(resolveComponentSource(pagesDir, exts, '../idt-escape-target')).toBeNull()
      expect(resolveComponentSource(pagesDir, exts, '../../../../etc/passwd')).toBeNull()
    } finally {
      rmSync(escapeFile, { force: true })
    }
  })
})

describe('source-link capability injection', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'idt-root-'))
    mkdirSync(join(root, 'src', 'pages'), { recursive: true })
    writeFileSync(join(root, 'src', 'pages', 'Home.tsx'), 'x')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('injects sourceLinks:true into the init module when dev + pagesDir exists', async () => {
    expect(await initModuleFor(root)).toContain('"sourceLinks":true')
  })

  it('omits the flag entirely when source links are disabled', async () => {
    expect(await initModuleFor(root, { sourceLinks: false })).not.toContain('sourceLinks')
  })

  it('omits the flag when pagesDir is missing, so names never dangle as links', async () => {
    expect(await initModuleFor(root, { sourceLinks: { pagesDir: 'does/not/exist' } })).not.toContain('sourceLinks')
  })
})

describe('source-dir auto-detection (works outside the Vite-default layout)', () => {
  function rootWith(dir: string): string {
    const root = mkdtempSync(join(tmpdir(), 'idt-layout-'))
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, 'Home.tsx'), 'x')
    return root
  }

  it('detects a Laravel resources/js/Pages layout when no src/pages exists', async () => {
    // The old hardcoded `src/pages` default silently disabled here — the exact
    // gap the review flagged for canonical Laravel apps. Revert DEFAULT_PAGES_DIRS
    // to a lone `src/pages` and this fails.
    const root = rootWith('resources/js/Pages')
    try {
      expect(await initModuleFor(root)).toContain('"sourceLinks":true')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('detects an Inertia Rails app/frontend/pages layout', async () => {
    const root = rootWith('app/frontend/pages')
    try {
      expect(await initModuleFor(root)).toContain('"sourceLinks":true')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('still disables when none of the known layouts exist', async () => {
    const root = rootWith('some/unrecognized/place')
    try {
      expect(await initModuleFor(root)).not.toContain('sourceLinks')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

interface FakeReq {
  method: string
  url: string
  headers: { origin?: string; host?: string }
}
interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader(k: string, v: string): void
  end(b?: string): void
}

/** A connect res stub that records the status/body the handler writes. */
function fakeRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      r.headers[k] = v
    },
    end(b) {
      r.body = b ?? ''
    },
  }
  return r
}

describe('the open endpoint refuses cross-site and non-POST callers', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'idt-endpoint-'))
    mkdirSync(join(root, 'src', 'pages'), { recursive: true })
    writeFileSync(join(root, 'src', 'pages', 'Home.tsx'), 'x')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  /** Mount configureServer with source links active and return the handler. */
  function openHandler(): (req: FakeReq, res: FakeRes) => void {
    const plugin = inertiaDevtools() as unknown as {
      configResolved(c: { command: 'serve'; mode: string; root: string }): void
      configureServer(s: { middlewares: { use(path: string, h: unknown): void } }): void
    }
    const previous = process.env.VITEST
    delete process.env.VITEST
    try {
      plugin.configResolved({ command: 'serve', mode: 'development', root })
    } finally {
      if (previous !== undefined) process.env.VITEST = previous
    }
    let handler: ((req: FakeReq, res: FakeRes) => void) | undefined
    plugin.configureServer({
      middlewares: {
        use(path, h) {
          if (path === '/__inertia-devtools/open') handler = h as (req: FakeReq, res: FakeRes) => void
        },
      },
    })
    if (!handler) throw new Error('endpoint was not mounted')
    return handler
  }

  it('rejects a GET with 405 — a cross-site <img>/link cannot launch the editor', () => {
    const res = fakeRes()
    openHandler()({ method: 'GET', url: '/?component=Home', headers: { host: 'localhost:5173' } }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a cross-origin POST with 403', () => {
    const res = fakeRes()
    openHandler()(
      { method: 'POST', url: '/?component=Home', headers: { origin: 'http://evil.com', host: 'localhost:5173' } },
      res,
    )
    expect(res.statusCode).toBe(403)
  })

  it('lets a same-origin POST past both guards (400 here only because component is absent)', () => {
    const res = fakeRes()
    openHandler()(
      { method: 'POST', url: '/', headers: { origin: 'http://localhost:5173', host: 'localhost:5173' } },
      res,
    )
    // Reaches the component check → 400, proving it cleared 405 and 403.
    expect(res.statusCode).toBe(400)
  })
})

describe('isSameOriginRequest', () => {
  it('accepts a matching origin/host', () => {
    expect(isSameOriginRequest('http://localhost:5173', 'localhost:5173')).toBe(true)
  })
  it('rejects a mismatched origin', () => {
    expect(isSameOriginRequest('http://evil.com', 'localhost:5173')).toBe(false)
  })
  it('allows a missing Origin (non-browser client; the POST-only guard covers drive-by GETs)', () => {
    expect(isSameOriginRequest(undefined, 'localhost:5173')).toBe(true)
  })
})
