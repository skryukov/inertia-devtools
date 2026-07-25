export type {
  DevToolsOptions,
  DevToolsState,
  RequestRecord,
  CapturedEvent,
  ActiveFeature,
  VisitType,
} from './core/types'
export type { InertiaPage, InertiaEventName } from './core/protocol'
/**
 * Type-only: lets consumers annotate `window.__INERTIA_DEVTOOLS_STORE__` without
 * making the class itself part of the supported API. Every VALUE export has to
 * be mirrored in the plugin's no-op module and carries a semver promise, so the
 * store, the capture loop, and the StoreClient shell protocol stay internal
 * until a second real shell needs them. `createInertiaDevtools` is the API.
 */
export type { DevToolsStore } from './core/store'
export { createInertiaDevtools, destroyInertiaDevtools } from './entry'
