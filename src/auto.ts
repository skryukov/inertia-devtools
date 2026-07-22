/**
 * Side-effect entry: `import 'inertia-devtools/auto'` boots the devtools in a
 * dev environment, the way a bare `import 'inertia-devtools'` used to.
 *
 * It lives in its own module so the MAIN entry can be `sideEffects: false` and
 * fully tree-shakeable. With auto-init inlined into the main entry, every
 * bundler had to keep the whole package — a guarded snippet that never booted
 * still shipped ~200 KB of dead devtools, including a publicly fetchable UI
 * chunk, to webpack/Rollup/Rspack/Laravel-Mix builds. Only THIS file is listed
 * in `sideEffects`, so importing anything else drops what it doesn't use.
 *
 * The Vite plugin does not rely on this file — it injects an explicit,
 * router-carrying `createInertiaDevtools()` call itself, and strips this entry
 * to a no-op in production builds just like the main one.
 */
import { shouldAutoInit, autoInitIfIdle } from './entry'

// Browser package without Node types — `process` exists only via bundler
// replacement of `process.env.NODE_ENV` (see shouldAutoInit's fail-closed path).
declare const process: { env: Record<string, string | undefined> }

const importMetaDev = (() => {
  try {
    const meta = import.meta as unknown as { env?: { DEV?: unknown } }
    return meta.env?.DEV
  } catch {
    return undefined
  }
})()

// `process.env.NODE_ENV` is read inside the arrow so it stays a bare, textually
// replaceable token for webpack/Rollup/esbuild.
if (typeof window !== 'undefined' && shouldAutoInit(importMetaDev, () => process.env.NODE_ENV)) {
  autoInitIfIdle()
}
