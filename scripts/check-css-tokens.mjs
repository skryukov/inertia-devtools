#!/usr/bin/env node
/**
 * Fail the build on a `var(--dt-*)` with no matching definition.
 *
 * Four tokens shipped referenced-but-undefined — `--dt-error`, `--dt-success`,
 * `--dt-warning`, `--dt-text-dim` — one of them introduced by a fix commit.
 * Three fell through to hardcoded hex fallbacks that bypassed light-theme
 * tuning entirely; the fourth had no fallback at all, so the text inherited its
 * parent colour instead of dimming. Nothing caught any of it: CSS custom
 * properties fail silently by design, and neither svelte-check nor the linter
 * looks across files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    // Test files never ship CSS; a --dt- token in a test string or JSDoc is not
    // a real definition or reference, so scanning them only produces phantoms.
    else if (/\.(svelte|ts)$/.test(entry) && !/\.test\.(svelte\.)?ts$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(SRC)
const defined = new Set()
/** token -> first file that references it, for the error message. */
const used = new Map()

for (const file of files) {
  const code = readFileSync(file, 'utf8')
  for (const m of code.matchAll(/(--dt-[a-z0-9-]+)\s*:/g)) defined.add(m[1])
  for (const m of code.matchAll(/var\(\s*(--dt-[a-z0-9-]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], file.replace(SRC, 'src/'))
  }
}

const missing = [...used].filter(([token]) => !defined.has(token))
if (missing.length > 0) {
  console.error('Undefined CSS custom properties:\n')
  for (const [token, file] of missing) console.error(`  ${token}  (first used in ${file})`)
  console.error(`\nDefine them in getBaseStyles() in src/ui/mount.ts, for BOTH themes.`)
  process.exit(1)
}

const unused = [...defined].filter((t) => !used.has(t) && !t.startsWith('--dt-overlay'))
if (unused.length > 0) {
  // Not fatal — a token can legitimately land a commit before its first use.
  console.log(`note: defined but unreferenced: ${unused.join(', ')}`)
}
console.log(`css tokens ok — ${defined.size} defined, ${used.size} referenced`)
