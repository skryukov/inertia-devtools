import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/svelte'
import TreeView from './TreeView.svelte'

/**
 * The first Svelte component test in this project. `@testing-library/svelte`
 * has been a devDependency all along, but no test imported it — and none
 * could: vitest.config.ts had no `svelte()` plugin, so importing a `.svelte`
 * file died at `</script>` with "invalid JS syntax", and Svelte resolved to its
 * server build where `mount` throws outright.
 *
 * This exists to prove the harness works end to end, so the next UI fix can be
 * covered rather than eyeballed. Half the source sat outside every quality gate
 * and every UI defect found in review lived in that half — not a coincidence.
 */
describe('TreeView', () => {
  afterEach(cleanup)

  it('renders top-level keys', () => {
    render(TreeView, { data: { users: [1, 2], component: 'Pages/Users' }, defaultOpen: true })
    expect(screen.getByText('users:')).toBeTruthy()
    expect(screen.getByText('component:')).toBeTruthy()
  })

  it('shows a redacted value as text rather than dropping the key', () => {
    // The redaction work masks values and keeps structure; this pins that the
    // panel still renders the shape afterwards.
    render(TreeView, { data: { csrf_token: '[REDACTED]' }, defaultOpen: true })
    expect(screen.getByText('csrf_token:')).toBeTruthy()
    expect(screen.getByText('"[REDACTED]"')).toBeTruthy()
  })

  it('leaves nested children collapsed past the first level', () => {
    render(TreeView, { data: { outer: { inner: 'deep-value' } }, defaultOpen: true })
    expect(screen.getByText('outer:')).toBeTruthy()
    // `initialOpen = defaultOpen || depth < 1`, so depth-1 nodes start closed.
    expect(screen.queryByText('"deep-value"')).toBeNull()
  })

  it('expands a node whose path is in forceExpand (search auto-expansion)', () => {
    render(TreeView, {
      data: { outer: { inner: 'deep-value' } },
      defaultOpen: true,
      forceExpand: new Set(['outer']),
    })
    expect(screen.getByText('"deep-value"')).toBeTruthy()
  })
})
