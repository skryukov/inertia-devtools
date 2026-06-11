# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog],
and this project adheres to [Semantic Versioning].

## [Unreleased]

## [0.2.0] - 2026-06-12

Requires Inertia.js >= 3.4. For Inertia v2 / v3.0–3.3, use the `0.1.x` line.

### Added

- Real wire data in the Network tab — status codes (including successes), actual request/response headers, and payload sizes — captured via Inertia's dev-mode interceptors (`window.__inertia_interceptors__`); prefetch responses and HTTP exceptions are extracted from their lifecycle events ([@skryukov])
- Cache-served navigations are detected from the `cached` flag on `inertia:navigate` and finalized correctly despite never receiving `start`/`finish` ([@skryukov])
- One-time console warning when the host app runs Inertia older than 3.4 ([@skryukov])

### Changed

- Event correlation is now keyed by Inertia's native visit UUID (`visit.id` / `detail.visitId`) instead of URL/method fingerprints — concurrent identical visits, out-of-order completion, and rapid prefetches now correlate exactly ([@skryukov])
- Client-side visits (`router.push`/`replace`/`replaceProp`/`appendToProp`/`prependToProp`) are captured from the `inertia:clientVisit` event instead of history API monkey-patching ([@skryukov])
- "Copy as Markdown" now includes a Network section with actual wire headers, status, and response size ([@skryukov])
- **Breaking:** the exported `DevToolsState` type gained a required `networkCaptureMode` field; the exported `InertiaEventName` union no longer includes `inertia:invalid`, `inertia:exception`, or `inertia:cancel` (use `inertia:httpException` / `inertia:networkError`) ([@skryukov])

### Removed

- **Breaking:** `startHistoryCapture` export (the history monkey-patch is gone) ([@skryukov])
- **Breaking:** `DevToolsStore.captureClientVisit` — client-side visits now arrive via the `inertia:clientVisit` event; no manual call is needed ([@skryukov])
- Support for Inertia v2 / v3.0–3.3 — peer dependency is now `@inertiajs/core >= 3.4.0` ([@skryukov])
- v2-only event handling (`inertia:invalid`, `inertia:exception`, `inertia:cancel`) ([@skryukov])

## [0.1.0] - 2026-02-25

### Added

- Initial release ([@skryukov])

[@skryukov]: https://github.com/skryukov
[Unreleased]: https://github.com/skryukov/inertia-devtools/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/skryukov/inertia-devtools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/skryukov/inertia-devtools/commits/v0.1.0
[Keep a Changelog]: https://keepachangelog.com/en/1.0.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
