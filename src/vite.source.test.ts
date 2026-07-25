import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inertiaDevtools, resolveComponentSource } from './vite'

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
