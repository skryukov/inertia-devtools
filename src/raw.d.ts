/**
 * Vite's `?raw` loader, declared locally rather than via `vite/client` so the
 * package keeps its minimal type surface (no DOM/ImportMeta globals leaking
 * into consumers' builds).
 */
declare module '*?raw' {
  const content: string
  export default content
}
