#!/usr/bin/env node
/**
 * Run the library build and fail if the compiler emitted any warning.
 *
 * `check:svelte` reported "0 warnings" while `npm run build` printed two
 * `state_referenced_locally` warnings the whole time: svelte-check type-checks
 * components, but the *compiler* warnings only surface through the Vite build,
 * and nothing read that output. A gate that says zero while the build says two
 * is not a gate, so this reads the build's own stdout/stderr.
 *
 * Warnings, not just errors: a Svelte compiler warning is how you learn a rune
 * is being read outside a closure, which compiles fine and silently captures a
 * stale value. That class of bug has no other detector here.
 */
import { spawnSync } from 'node:child_process'

/**
 * Markers that mean "the toolchain wants your attention". Kept narrow on
 * purpose: matching a bare /warn/ would trip on file names and dependency
 * chatter, and a gate that cries wolf gets disabled.
 */
const WARNING_MARKERS = [
  /\[vite-plugin-svelte\]/, // Svelte compiler warnings are logged under this tag
  /svelte\.dev\/e\//, // the docs link every Svelte warning prints
  /^\(!\)/m, // Rollup's warning prefix
]

const result = spawnSync('npm', ['run', 'build'], { encoding: 'utf8', shell: process.platform === 'win32' })
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

process.stdout.write(output)

if (result.status !== 0) {
  console.error('\nbuild failed')
  process.exit(result.status ?? 1)
}

const offending = output
  .split('\n')
  .filter((line) => WARNING_MARKERS.some((marker) => marker.test(line)))
  .filter(Boolean)

if (offending.length > 0) {
  console.error(`\nbuild emitted ${offending.length} warning line(s) — fix them or suppress them explicitly:`)
  for (const line of offending) console.error(`  ${line.trim()}`)
  process.exit(1)
}

console.log('build warnings ok — compiler emitted none')
