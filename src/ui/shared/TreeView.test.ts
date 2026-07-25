import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte'
import TreeView from './TreeView.svelte'
import { searchPaths } from './tree-search'

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

  it('expands ancestors to reveal a search match', () => {
    const data = { outer: { inner: 'deep-value' } }
    const { matches, expand } = searchPaths(data, 'deep-value')
    render(TreeView, { data, defaultOpen: true, searchMatches: matches, forceExpand: expand })
    expect(screen.getByText('"deep-value"')).toBeTruthy()
  })

  it('renders only match paths while searching, and says what it hid', () => {
    // Expanding used to render ALL children of an expanded node, so one
    // keystroke against a large collection mounted thousands of nested
    // TreeViews synchronously on the host app's main thread.
    const data = { wanted: 'needle', noise1: 'x', noise2: 'y', noise3: 'z' }
    const { matches, expand } = searchPaths(data, 'needle')
    render(TreeView, { data, defaultOpen: true, searchMatches: matches, forceExpand: expand })

    expect(screen.getByText('wanted:')).toBeTruthy()
    expect(screen.queryByText('noise1:')).toBeNull()
    expect(screen.queryByText('noise2:')).toBeNull()
    expect(screen.getByText(/3 non-matching keys hidden/)).toBeTruthy()
  })

  it('renders every child when no search is active', () => {
    render(TreeView, { data: { a: 1, b: 2, c: 3 }, defaultOpen: true })
    expect(screen.getByText('a:')).toBeTruthy()
    expect(screen.getByText('c:')).toBeTruthy()
    expect(screen.queryByText(/hidden/)).toBeNull()
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })

  it('caps a huge collection even with NO search, and reveals more on demand', async () => {
    // The B5 gap: the render budget used to bind only while searching, so
    // expanding a plain 10k-element array mounted 10,002 components on the host
    // app's main thread. That expand is the whole point of the tool.
    const data = { users: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`u${i}`, i])) }
    render(TreeView, { data: data.users, defaultOpen: true })

    // First 50 rendered, the rest deferred behind the affordance.
    expect(screen.getByText('u0:')).toBeTruthy()
    expect(screen.queryByText('u49:')).toBeTruthy()
    expect(screen.queryByText('u50:')).toBeNull()
    expect(screen.getByText('250 not shown')).toBeTruthy()

    await fireEvent.click(screen.getByText(/Show 100 more/))
    expect(screen.queryByText('u149:')).toBeTruthy()
    expect(screen.getByText('150 not shown')).toBeTruthy()
  })

  it('lets an explicit collapse win over search auto-expansion', async () => {
    // `forceExpand` used to be OR-ed on top of the user's state, so clicking to
    // collapse a noisy subtree mid-search did nothing — the arrow did not flip.
    const data = { outer: { inner: 'deep-value' } }
    const { matches, expand } = searchPaths(data, 'deep-value')
    render(TreeView, { data, defaultOpen: true, searchMatches: matches, forceExpand: expand })
    expect(screen.getByText('"deep-value"')).toBeTruthy()

    await fireEvent.click(screen.getByText('outer:'))
    expect(screen.queryByText('"deep-value"')).toBeNull()
  })
})

describe('TreeView ARIA tree pattern (B7a)', () => {
  afterEach(cleanup)

  it('exposes a tree with treeitems carrying level and expansion', () => {
    const { container } = render(TreeView, { data: { users: { a: 1 }, name: 'x' }, defaultOpen: true })
    expect(container.querySelector('[role="tree"]')).toBeTruthy()
    const items = container.querySelectorAll('[role="treeitem"]')
    expect(items.length).toBeGreaterThan(0)
    // An expandable node reports aria-expanded; a leaf reports its level.
    const expandable = [...items].find((el) => el.getAttribute('aria-expanded') !== null)
    expect(expandable).toBeTruthy()
    expect(items[0].getAttribute('aria-level')).toBe('1')
  })

  it('is ONE tab stop, not 502 — items are tabindex=-1', () => {
    // The headline defect: every toggle used to be a bare <button>, so expanding
    // a big collection created a tab stop per row.
    const data = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))
    const { container } = render(TreeView, { data, defaultOpen: true })
    const tabbable = container.querySelectorAll('[role="tree"][tabindex="0"]')
    expect(tabbable.length).toBe(1)
    const items = container.querySelectorAll('[role="treeitem"]')
    expect([...items].every((el) => el.getAttribute('tabindex') === '-1')).toBe(true)
  })

  it('ArrowDown/Up move focus between visible treeitems', async () => {
    const { container } = render(TreeView, { data: { a: 1, b: 2, c: 3 }, defaultOpen: true })
    const tree = container.querySelector('[role="tree"]') as HTMLElement
    const items = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')]

    await fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    await fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    await fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0])
  })

  it('ArrowRight expands a collapsed node, ArrowLeft collapses it', async () => {
    const { container } = render(TreeView, { data: { outer: { inner: 'deep' } }, defaultOpen: true })
    const tree = container.querySelector('[role="tree"]') as HTMLElement
    // The "outer" child treeitem (depth 1, starts collapsed) — matched by its
    // key label, not preview text, so the root node (whose preview also contains
    // "outer") is not picked by mistake.
    const outer = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((el) =>
      [...el.querySelectorAll('.key')].some((k) => k.textContent === 'outer:'),
    )!
    outer.focus()
    expect(outer.getAttribute('aria-expanded')).toBe('false')

    await fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(outer.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('"deep"')).toBeTruthy()

    await fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(outer.getAttribute('aria-expanded')).toBe('false')
  })

  it('Home/End jump to the first and last visible treeitem', async () => {
    const { container } = render(TreeView, { data: { a: 1, b: 2, c: 3 }, defaultOpen: true })
    const tree = container.querySelector('[role="tree"]') as HTMLElement
    const items = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')]

    await fireEvent.keyDown(tree, { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    await fireEvent.keyDown(tree, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })
})
