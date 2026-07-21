# Inertia DevTools

In-app developer tools for [Inertia.js](https://inertiajs.com/) v3.4+. See what happens behind every click.

Inertia 3.6 features — `inertia:location` redirect details and `router.poll()` detection — light up automatically and degrade gracefully on 3.4/3.5. Known 3.4/3.5 limits: polls appear as ordinary reloads (partial when `only`/`except` is used), and 409 hard reloads fire no Inertia event — they surface best-effort via Resource Timing (Chromium 109+) as "409 Conflict — server forced a full page reload". On all versions, capture is scoped to Inertia router visits — `useHttp` calls, precognition requests, and custom HTTP clients don't go through it.

<p align="center">
  <img src=".github/screenshot.png" alt="Inertia DevTools screenshot" width="800">
</p>

## Installation

```sh
npm install inertia-devtools --save-dev
```

## Quick Start

### With Vite (recommended)

Add the plugin to your `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { inertiaDevtools } from 'inertia-devtools/vite'

export default defineConfig({
  plugins: [
    inertiaDevtools(),
    // ... other plugins
  ],
})
```

The plugin auto-injects devtools into your Inertia entrypoint on the dev server and strips them from every build automatically.

> [!NOTE]
> Auto-injection looks for a module that imports `createInertiaApp` from an `@inertiajs/*` package. If you wrap that import behind your own module, add `import 'inertia-devtools'` to your entrypoint yourself — the plugin still handles options and production stripping.

### Without Vite

Import and initialize manually:

```ts
import { createInertiaDevtools } from 'inertia-devtools'

if (process.env.NODE_ENV === 'development') {
  createInertiaDevtools()
}
```

Importing the module auto-initializes devtools in development. The auto-init is gated on your bundler's `process.env.NODE_ENV` replacement, so production builds get dead code even without the Vite strip plugin — but only the plugin guarantees zero shipped bytes.

> [!NOTE]
> When the Vite plugin is active, pass options to `inertiaDevtools({ ... })` in `vite.config.ts` — the plugin initializes devtools before app code runs, so a later `createInertiaDevtools(options)` call in the app is a no-op.

## Features

### Props Inspector

Browse page props in an expandable tree. Search by key or value — matches highlight and auto-expand. Toggle byte sizes per prop.

### Props Diff

Compare props between navigations. Added, removed, and changed keys are highlighted with a change count badge.

### Network Tab

HTTP request/response data as Inertia's router sees it: status codes, request and response headers (`X-Inertia-*` highlighted), timing, and payload size — captured via Inertia's dev-mode interceptors. Request headers are snapshotted before Inertia's HTTP client adds `X-XSRF-TOKEN` and `Content-Type`, and redirect hops are followed transparently (a POST → 303 → GET shows as one record with the final status) — for raw HTTP truth, use the browser's Network panel. When interceptors are unavailable, falls back to timing-only data with protocol fields inferred from client-side state.

If your server emits a [`Server-Timing`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing) header, its metrics (database, view, etc.) render as a per-request breakdown with proportional bars.

### Events Timeline

Full Inertia lifecycle in chronological order:

```
before → start → navigate → success → finish
```

Includes visit options (`replace`, `preserveState`, `errorBag`, etc.) and expandable raw event data.

### Feature Detection

Badges appear automatically for active Inertia features:

| Badge         | Feature                            |
| ------------- | ---------------------------------- |
| PARTIAL       | Partial reload (`only` / `except`) |
| DEFERRED      | Deferred props                     |
| MERGE         | Merge strategy                     |
| DEEP MERGE    | Deep merge strategy                |
| PREPEND       | Prepend strategy                   |
| SCROLL        | Scroll regions                     |
| ONCE          | Once props                         |
| PREFETCH      | Prefetched request                 |
| CACHED        | Served from the prefetch cache     |
| POLL          | `router.poll()` traffic (3.6+)     |
| FLASH         | Flash data present                 |
| REMEMBER      | Remembered local state             |
| ENCRYPTED     | Encrypted history                  |
| CLEAR HISTORY | History cleared on this page       |

Each badge links to the relevant documentation page. POLL needs the `poll` flag Inertia only sets from 3.6 — on 3.4/3.5 poll ticks are indistinguishable from ordinary reloads and are listed as such.

### Request Filtering

Toggle visibility by category: visits, mutations, partial, deferred, prefetch, poll, and client-side visits. Chips only appear for categories present in the current session, so the poll chip stays hidden on 3.4/3.5.

### Copy for AI

Every tab has a context-aware Copy button: full request summary, props diff, events timeline, or network data as focused markdown for GitHub issues and AI chats — plus a stable JSON export of the whole request record.

### More

- **Picture-in-Picture** -- pop the panel out into its own window
- **Dark/light/system theme** with manual override
- **Replay** -- re-issue a selected GET visit (same partial-reload keys) from the panel; non-GET replays are refused since they would re-submit the mutation. Needs the app's router — automatic with the Vite plugin, manual installs pass `router` in options
- **Keyboard navigation** -- `Alt+Shift+D` toggles the panel; arrow keys browse requests, Escape deselects
- **Previous session** -- requests from before page reload in a collapsible section
- **Draggable trigger** -- floating icon with position persisted to localStorage
- **Shadow DOM isolation** -- styles never leak into your app
- **Framework agnostic** -- works with React, Vue, and Svelte

## Options

```ts
createInertiaDevtools({
  styleNonce: 'abc123', // CSP nonce for the base stylesheet (see note below)
  enabled: true, // set to false to disable
  docsProvider: 'inertiajs', // or 'inertia-rails'
  router, // pass @inertiajs/core's router to enable Replay (the Vite plugin injects it automatically)
})
```

## How It Works

Listens to Inertia DOM events and correlates them into request records by visit id. Client-side visits (`router.push`/`replace`/`replaceProp`/...) arrive via the `inertia:clientVisit` event. Network data (headers, status, body size) comes from Inertia's dev-mode interceptors (`window.__inertia_interceptors__`, exposed when `createInertiaApp`'s `dev` option is on — the default in Vite dev mode), with PerformanceObserver supplying resource timing and acting as the fallback. Nothing is monkey-patched.

The UI renders inside a Shadow DOM -- your app styles are never affected.

`styleNonce` covers the devtools' base stylesheet only. Per-component CSS is injected at runtime by Svelte, which sets no nonce and exposes no hook for one, so under a strict `style-src 'nonce-...'` policy (no `unsafe-inline`) the panel renders unstyled and your CSP report-uri will collect violations from it. If you run that policy, keep devtools off those environments for now.

State is kept in a bounded buffer (200 requests max).

In any build the Vite plugin resolves devtools imports to a no-op, so `import 'inertia-devtools'` can stay in your code permanently — zero bytes ship to users. Stripping keys off `vite build`, not off `--mode`: a preview or QA host built with `--mode development` is still a build, and still strips. Devtools appear on the dev server (`vite`) whatever the mode.

To ship devtools inside a build on purpose, opt out explicitly with `inertiaDevtools({ stripInProduction: false })` and pair it with the runtime `enabled` option to control who sees the panel.

## Requirements

- [Inertia.js](https://inertiajs.com/) v3.4+
- Modern evergreen browser (ES2022 build target; uses `Array.prototype.toSorted`, ES2023)

### Version compatibility

| inertia-devtools | Inertia.js     |
| ---------------- | -------------- |
| 0.2.x            | >= 3.4         |
| 0.1.x            | v2.x, v3.0–3.3 |

## Development

```sh
npm install
npm test
npm run build
```

## License

MIT
