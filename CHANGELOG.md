# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog],
and this project adheres to [Semantic Versioning].

## [Unreleased]

### Security

- Exports no longer leak server props. `Copy for AI` / `Copy JSON` / `Copy raw` shipped page props verbatim, and the Rails and Laravel adapters put a live `csrf_token` in props on **every** page — so a developer pasting a failing form into a public GitHub issue shipped a live CSRF token, whatever session or API tokens the app shares, and the signed-in user's PII. Props stay unmasked in the panel on purpose (you cannot debug props you cannot see); the clipboard is a different audience. All five exporters plus the raw-copy button now mask on the way out, covering `page`, `previousPage`, and `events[].detail` — which holds a second full copy of the props via `structuredClone`. The export walker has no depth cap, unlike the capture-path one, because bailing out past a depth limit returns the raw subtree ([@skryukov])
- Credentials are redacted before anything reaches the store. A login POST previously put its request body (`password`) and headers (`Authorization`, `X-CSRF-Token`) into the panel verbatim and, worse, into the "Copy for AI" / JSON export — a feature whose whole purpose is pasting into an issue or a chat. Values under keys matching `password`/`secret`/`token`/`authorization`/`cookie`/`csrf`/`api_key`/`credential` are now masked at capture time, across all three routes that carried them: visit options, wire request/response headers, and raw event details. Structure is preserved so the shape stays debuggable, and `authorization` is spelled out rather than `auth` so an ordinary `author` prop is untouched. Server-sent page props are deliberately not filtered — they are the product ([@skryukov])

### Documentation

- The POLL badge and poll filter are marked 3.6+. Inertia only sets the `poll` flag from 3.6, so on 3.4/3.5 — the versions the peer range declares as the floor — poll ticks are indistinguishable from ordinary reloads and the badge never appears ([@skryukov])

### Fixed

- Copy buttons no longer throw into the host app, and no longer claim success when they failed. `navigator.clipboard.writeText` was called bare: on a non-secure origin (`http://192.168.1.x:5173`, the standard way to test a dev server from a phone) `navigator.clipboard` is `undefined`, so it threw a synchronous TypeError out of a click handler into the app's `window.onerror`/Sentry; from the popped-out PiP window it rejects `NotAllowedError` because that document isn't focused, as an unhandled rejection — while the panel still said "Copied!". `copyToClipboard` now resolves a boolean and the toast reports what actually happened ([@skryukov])
- The Vite plugin fails safe on hosts that never call `configResolved`. That hook is Vite-only, so a plain Rollup consumer kept the plugin's defaults — which said "development": no stripping plus auto-injection, i.e. a production bundle that imported and booted the devtools. The defaults are now the stripped ones and Vite flips them to the truth. Verified against a real Rollup build ([@skryukov])
- The plugin strips under Vitest. Vitest resolves config with `command: 'serve'` and a non-SSR web transform, so a consumer who added the plugin got the full devtools booted inside every jsdom test: a `#inertia-devtools-host` div in `document.body` breaking `innerHTML` snapshots, a `pagehide` listener per test, and the UI chunk in the test runner. Vitest reads `vite.config.ts`, so that was the default outcome, not an edge case ([@skryukov])

### Fixed

- A 409 learned only from the response interceptor now produces its `version-mismatch` diagnostic. `attachWireResponse` set `status` without recomputing diagnostics, while its sibling `attachNetworkTiming` did — so whether the warning appeared depended on which capture source saw the status first ([@skryukov])
- Evicting a record no longer orphans a live one that shares its visit id. After an `x-inertia-redirect` two records share a uuid (Inertia reuses the id) and the map points at the newer; `deleteRecord` unlinked it unconditionally, so the live record's own `inertia:finish` resolved to nothing ([@skryukov])
- `record.events` is capped. It had no bound at all, and every id-less event (`progress`, `flash`, `httpException`, `networkError`, `beforeUpdate`) attaches to the newest in-flight record — so a visit that never finishes, a hung request or a backgrounded tab, accumulated indefinitely. Progress events are dropped first since the Events tab already collapses runs of them, and the count is recorded on the request ([@skryukov])
- Arrow keys no longer stop the host app from scrolling. With the panel open they were `preventDefault()`ed on the whole document unless focus sat in a form field; they are now handled only when the event originates inside the devtools. Since `panelOpen` persists across reloads this read as "arrow keys stopped working" with no obvious cause ([@skryukov])
- The keyboard handler reads `composedPath()[0]` rather than `e.target`. The listener is on the document, so anything inside a shadow root is retargeted to the shadow host first — meaning the devtools' own Filter and Search boxes, and any web-component input in the host app (Shoelace, Lit, Ionic), were treated as "nobody owns these keys" and lost their arrows, Escape and `Alt+Shift+D` ([@skryukov])

- Prop search no longer freezes the page. Expanding a node rendered _all_ of its children, so a one-letter query against a 500-row collection auto-expanded ~500 paths and mounted thousands of nested tree components synchronously — on the host app's main thread, since the devtools share it. The tree now renders only match paths and caps children per node, reporting what it left out: measured 2,002 nodes / 332ms down to 202 nodes / 82ms. The 150ms debounce delayed that freeze; it never prevented it ([@skryukov])
- A node force-expanded by the search can be collapsed again. `forceExpand` was OR-ed over the user's state, so clicking to collapse a noisy subtree mid-search did nothing — the arrow did not even flip ([@skryukov])
- Feature badges meet contrast. White text on the lighter accents measured ~1.9:1 (yellow) to ~2.5:1, well under AA, on what is a headline feature. Badges now use the accent as text on a tint of itself, inheriting the contrast the tokens were already tuned for ([@skryukov])
- The request-list resizer works in the popped-out window. `useResizable` bound move/up listeners to the module-global `document` — the opener's — so in PiP the drag never ended: listeners were never removed and `resizing` latched true, after which any mouse movement in the user's app resized the panel. It now binds to the handle's own document and also handles `pointercancel`, which fires _instead of_ `pointerup` when a browser gesture steals the pointer ([@skryukov])
- Redaction reaches class instances. The walker only descended into object literals, so a form model or Precognition object was skipped — while `JSON.stringify` ignores prototypes and wrote its `password` straight into the export ([@skryukov])

- Deferred records are only adopted by the initial page load. The orphan-adoption loop was commented "on initial page load" but never checked — every back/forward navigation also creates a synthetic record, so it re-parented long-finished deferred records to a parent that started after they did and overwrote their diff baseline ([@skryukov])
- A burst of `prefetch="mount"` links is fully recorded. Pending prefetches were capped at 20 and the overflow FIFO-dropped, so on a list of 25 the first five had no record at all — no row, no trace ([@skryukov])
- The trigger's status indicator no longer latches. Its `$effect` depended on the store tick and its teardown cleared the 1500ms reset timer, so every notify killed the timer while `setEffect` early-returned on the unchanged classification — leaving the indicator stuck on its last state for the rest of the session ([@skryukov])
- Capture teardowns are retained and `pagehide` is removed. All three `StopFunction`s were discarded, so during the devtools' own HMR each reload stacked another set of live listeners while the re-evaluated module was a permanent no-op. `destroyInertiaDevtools()` is now exported ([@skryukov])
- Arrow keys walk the rows actually on screen and scroll them into view. They walked the whole buffer, so with a filter active they selected rows not in the list, and nothing called `scrollIntoView` — browsing a long list walked off-screen silently ([@skryukov])
- The detail tabs implement the WAI-ARIA tabs pattern rather than only its markup: `aria-controls`, `aria-labelledby`, roving `tabindex`, and arrow/Home/End handling. `role="tab"` without those announces a tab widget and then behaves like a row of buttons ([@skryukov])

### Internal

- The UI layer is inside the quality gates for the first time. `tsconfig.json` listed `src/**/*.svelte`, but `tsc` cannot parse Svelte and silently ignored it — `strict: true` said nothing about roughly half the source. `svelte-check` now runs in CI (verified by planting a type error: previously silent, now exit 1). `vitest.config.ts` had no `svelte()` plugin, so importing any `.svelte` file died at `</script>` and `@testing-library/svelte` was a devDependency no test could have used; the plugin and the browser resolve condition are in, with a first component test to prove the harness works end to end. Coverage was scoped to `src/core`, reporting ~95% while the project overall sits at ~57% with `src/ui/panels` at 0% — that scoping is gone, so the number is honest even though it now looks worse ([@skryukov])

- `record.url` is a path again (`/users?page=2`), not an absolute URL. Events reach the correlator through the store, whose `safeClone` had already stringified Inertia's `URL` instance — so the `url instanceof URL` branch was dead in production and `url` sat next to the normalized `redirectUrl` in a different format. Every correlator test hands `processEvent` a hand-built event and so never saw the production shape; the seam between store and correlator is now covered ([@skryukov])
- A visit superseded by an `x-inertia-redirect` is finalized instead of hanging in flight forever. Inertia reuses the visit id when it follows that redirect (`getPendingVisit` spreads the caller's options, including `id`, after `id: createVisitId()`), so two records claimed one uuid: the first never received its `finish`, kept absorbing every id-less event through the in-flight fallback, and survived eviction indefinitely because `evictOldest` prefers finished records. It now reads as the redirect it actually was ([@skryukov])
- Validation errors render as text in the panel, not `[object Object]`. Adapters send arrays and nested bags as often as strings; 0.2.0 fixed this for the markdown export and left the Errors pane interpolating raw values. Flash entries share the same helper now ([@skryukov])
- Blocked site data can no longer break the panel **or the host app**. Merely touching `window.localStorage`/`sessionStorage` throws `SecurityError` when site data is blocked (Safari "Block All Cookies", partitioned third-party iframes, Chrome with cookies blocked for the origin), and `setItem` throws in Safari private mode. Three separate consequences: the settings read during store setup killed the mount with "Failed to load UI"; the settings write threw out of a click handler into the host app's error reporting; and `session.ts` guarded with `typeof sessionStorage === 'undefined'` **outside** its `try` — but `sessionStorage` is an accessor, so `typeof` invokes it and throws, meaning the guard failed in precisely the case it existed for. That last one ran from the `DevToolsStore` constructor, which sat above `entry.ts`'s `try`, so it escaped into the host app's entrypoint at module-eval time and took the app down with it. Storage access is now guarded everywhere, including the property read, and the constructor runs inside its own guard ([@skryukov])
- The Vite plugin no longer keeps devtools in `vite build --mode development`. Stripping now keys off `vite build` rather than `--mode`, so a preview or QA host built with that flag no longer serves a live, mounting devtools panel to every visitor. The plugin's injected `_init()` call bypasses the runtime `NODE_ENV` gate, so stripping was the only thing standing between that flag and a public panel. Shipping devtools in a build is now one explicit opt-in (`stripInProduction: false`) instead of an implicit consequence of a mode chosen for unrelated reasons ([@skryukov])
- The generated init module imports the router from the adapter the app actually uses (`@inertiajs/react`/`vue3`/`svelte`) instead of hard-coding `@inertiajs/core`, and probes resolvability before emitting the import. Apps depend on the adapter, not on core, so under pnpm, Yarn PnP, or any isolated `node_modules` the hard-coded import was unresolvable — which failed the module graph and took the whole app down with a 500, merely for adding the plugin. When nothing resolves, the router is omitted and only replay/reload go dark ([@skryukov])
- The dev server injects devtools whatever the mode — `vite --mode staging` previously skipped injection silently ([@skryukov])
- `createInRealmClient` is stubbed in the no-op module. It became a public export in 0.2.0 without a matching stub, so any app importing it built fine in dev and failed the production build with "not exported by inertia-devtools-noop". The test guarding this now derives the expected stub list from `src/index.ts` instead of restating the implementation, so it cannot drift again ([@skryukov])

## [0.2.0] - 2026-07-20

Requires Inertia.js >= 3.4. For Inertia v2 / v3.0–3.3, use the `0.1.x` line.

### Added

- Real wire data in the Network tab — status codes (including successes), actual request/response headers, and payload sizes — captured via Inertia's dev-mode interceptors (`window.__inertia_interceptors__`); prefetch responses and HTTP exceptions are extracted from their lifecycle events ([@skryukov])
- Cache-served navigations are detected from the `cached` flag on `inertia:navigate` and finalized correctly despite never receiving `start`/`finish` ([@skryukov])
- Visits blocked by `preventDefault()` on `inertia:before` (the confirm-dialog pattern) are recorded as finalized prevented rows with an info diagnostic instead of phantom in-flight records ([@skryukov])
- Inertia 3.6: the `inertia:location` event enriches server redirects with the exact target URL and tells "Version mismatch — full page reload" apart from "Server redirect via inertia_location" (the distinction requires the 409 response to carry `X-Inertia-Version`) ([@skryukov])
- Response status fallback from Resource Timing (`responseStatus`, Chrome 109+): fills statuses the interceptors never see — non-2xx responses and `dev: false` apps. On Inertia 3.4/3.5 a 409 hard reload fires no event at all, so this best-effort trace (flagged "409 Conflict — server forced a full page reload") is its only signal ([@skryukov])
- Inertia 3.6: `router.poll()` traffic is classified as `poll` with a POLL badge and its own request-list filter, and consecutive polls of the same URL collapse into an expandable group row ([@skryukov])
- Server-Timing lane in the Network tab: `PerformanceResourceTiming.serverTiming` metrics render as proportional bars per request and are included in markdown exports — works in both interceptor and fallback capture modes ([@skryukov])
- Picture-in-Picture: pop the panel out into its own window (same-origin popup; docked panel restores when it closes) ([@skryukov])
- Per-tab "Copy for AI": props diff, events timeline, and network section as focused markdown, plus a stable JSON export of the full request record ([@skryukov])
- The Vite plugin strips devtools from production builds — imports resolve to a no-op, so `import 'inertia-devtools'` can stay in app code permanently; opt out with `stripInProduction: false` ([@skryukov])
- Props-tree search: filter the props inspector by key or value, with matches highlighted and ancestors auto-expanded — manual expand state survives clearing the query ([@skryukov])
- Replay action: re-issue a selected GET visit (same `only`/`except`) straight from the panel — the Vite plugin hands devtools the app's own router instance via its init module; non-GET replays are refused (they would re-submit the mutation), and manual-import users can pass `router` to `createInertiaDevtools` ([@skryukov])
- `Alt+Shift+D` toggles the panel from anywhere (respects inputs, contenteditable, and ARIA widgets; focuses the PiP window while popped out) ([@skryukov])
- One-time console warning when the host app runs Inertia older than 3.4 ([@skryukov])
- A partial reload that lands on a different component is reported as ignored, naming both components. The server only honors `only`/`except` when the component matches the page the visit was issued from, so a partial that hits an auth redirect (or any route rendering another page) gets a full response — previously flagged as the server failing to send a prop it was never asked for ([@skryukov])
- Inertia 3.6: `rescuedProps` support — a prop whose server-side resolver threw and was rescued (`Inertia::defer(..., rescue: true)`) is reported as "failed to resolve on the server and was rescued" instead of being mistaken for a missing prop. Only newly-rescued props warn; the list persists across visits until a partial reload re-requests them ([@skryukov])

### Changed

- Event correlation is now keyed by Inertia's native visit UUID (`visit.id` / `detail.visitId`) instead of URL/method fingerprints — concurrent identical visits, out-of-order completion, and rapid prefetches now correlate exactly ([@skryukov])
- Client-side visits (`router.push`/`replace`/`replaceProp`/`appendToProp`/`prependToProp`) are captured from the `inertia:clientVisit` event instead of history API monkey-patching ([@skryukov])
- "Copy as Markdown" now includes a Network section with actual wire headers, status, and response size ([@skryukov])
- The UI consumes the store through a new `StoreClient` boundary (`createInRealmClient` exported) — no behavior change today; groundwork for pop-out, iframe, and extension shells ([@skryukov])
- **Breaking:** the exported `DevToolsState` type gained a required `networkCaptureMode` field; the exported `InertiaEventName` union no longer includes `inertia:invalid`, `inertia:exception`, or `inertia:cancel` (use `inertia:httpException` / `inertia:networkError`) ([@skryukov])

### Removed

- **Breaking:** `startHistoryCapture` export (the history monkey-patch is gone) ([@skryukov])
- **Breaking:** `DevToolsStore.captureClientVisit` — client-side visits now arrive via the `inertia:clientVisit` event; no manual call is needed ([@skryukov])
- Support for Inertia v2 / v3.0–3.3 — peer dependency is now `@inertiajs/core >= 3.4.0` ([@skryukov])
- v2-only event handling (`inertia:invalid`, `inertia:exception`, `inertia:cancel`) ([@skryukov])

### Fixed

- Events tab classification: `inertia:networkError`, `inertia:beforeUpdate`, and `inertia:clientVisit` were misfiled and miscolored by case-sensitive substring matching — replaced with an explicit per-event lookup ([@skryukov])
- Network tab explains cache-served visits ("Served from the prefetch cache — no request was made") instead of claiming no data was captured ([@skryukov])
- "Initial page load" is now an explicit marker on the record instead of a zero-duration heuristic, so mid-session history restores are no longer mislabeled ([@skryukov])
- The debounced session save is flushed on `pagehide`, so the 409/`inertia:location` record that explains a hard reload survives into the previous-session view instead of being lost inside the debounce window ([@skryukov])
- The Vite plugin's auto-injection now survives module invalidation (dep-optimizer reloads, entry edits) — previously a one-shot flag silently dropped the devtools import on re-transform ([@skryukov])
- Production safety without the Vite plugin: auto-init is gated on the bundler's `process.env.NODE_ENV` replacement, and `sideEffects` now covers the chunks that actually carry the side effect — bare imports no longer risk shipping devtools to production or being tree-shaken away in development ([@skryukov])
- The Vite plugin injects into every `createInertiaApp` module instead of a single claim slot — multi-entry apps previously lost the injection to whichever entry transformed first; the import is appended (ESM hoisting preserves execution order) so original line numbers survive without a sourcemap ([@skryukov])
- Panel keyboard shortcuts no longer steal arrow keys from contenteditable editors (Tiptap/ProseMirror/Lexical) or ARIA widgets (listbox/menu/tree), and respect keys the host app already handled ([@skryukov])
- Props diff honesty: page objects are captured via `structuredClone` at full depth (also cheaper at navigation commit), and any residually depth-truncated values now diff as changed instead of silently "unchanged" ([@skryukov])
- Network numbers: a legitimate 0ms Resource Timing duration is no longer dropped, parsed-payload body sizes are measured in UTF-8 bytes instead of UTF-16 code units, and the timing line's tooltip states which source produced each number (interceptor durations include client-side processing) ([@skryukov])
- Concurrent async/optimistic visits no longer misattribute pages: `inertia:success`/`inertia:error` carry the page with an exact visit id and are now the authoritative page source, the id-less `beforeUpdate` fallback no longer sets record pages, and heuristically-attributed events are marked with a `~` in the Events tab ([@skryukov])
- Diagnostics tell the truth: the `errors-filtered` rule is gone (its premise is false — Laravel/Rails adapters share errors via `always()`), replaced by a stale-errors rule reflecting real partial-merge semantics; `partial-prop-missing` understands dot-path partials (`only: ['users.data']`); new "Response discarded — a later navigation superseded this visit" diagnostic for async responses dropped by `shouldSetPage` ([@skryukov])
- Network tab honesty: headers are labeled as the pre-client snapshot (captured before `X-XSRF-TOKEN`/`Content-Type` injection, redirect hops followed transparently) with a footnote pointing at the browser's Network panel for HTTP truth; the fallback notice no longer asserts a false cause; README documents traffic devtools cannot see (`useHttp`, precognition, custom clients) ([@skryukov])
- The bundled Svelte runtime no longer registers itself in `window.__svelte.v`, so Svelte host apps don't get a spurious "multiple Svelte versions" warning ([@skryukov])
- Feature badge fixes: ONCE and SCROLL docs links point at the current pages, and CLEAR HISTORY correctly describes key rotation (entries persist but become unrestorable) ([@skryukov])
- "Deferred props failed to load" now actually fires for HTTP failures — `inertia:httpException` records the error on the visit (previously only network/JS errors did), and the prop-shape diagnostics (`partial-prop-missing`, `stale-errors`) stay silent on failed requests instead of false-alarming about props a failed response never carried ([@skryukov])
- Copy for AI no longer renders validation errors as `[object Object]`: the markdown export gives them their own Validation Errors section and the JSON export keeps them structured, so the field messages survive the trip into an issue or chat ([@skryukov])
- Failure is tracked separately from `error`, which also holds validation errors: a partial reload carrying errors forward is not a failed request, so `stale-errors` fires on it again (the failed-request guard had silenced the very rule it was meant to protect) and a deferred group whose response merely carried errors is no longer reported as "failed to load" ([@skryukov])
- The Vite plugin no longer injects devtools into the Inertia adapter itself. It matched the bare `createInertiaApp` identifier, which also appears in `@inertiajs/react`'s own dist — and the `node_modules` path check misses that whenever the adapter is workspace-linked or `npm link`ed, so the injected import resolved from the adapter's directory and crashed the dev server. Injection now requires an actual `import { createInertiaApp } from '@inertiajs/*'` ([@skryukov])
- The Vite plugin skips the SSR graph, where devtools cannot run anyway: injecting there pulled the whole UI into the server bundle and broke Inertia 3.6's SSR dev endpoint ([@skryukov])

## [0.1.0] - 2026-02-25

### Added

- Initial release ([@skryukov])

[@skryukov]: https://github.com/skryukov
[Unreleased]: https://github.com/skryukov/inertia-devtools/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/skryukov/inertia-devtools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/skryukov/inertia-devtools/commits/v0.1.0
[Keep a Changelog]: https://keepachangelog.com/en/1.0.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
