import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/svelte'
import DiffTreeView from './DiffTreeView.svelte'
import type { DiffNode } from '../../core/diff'

function changed(key: string): DiffNode {
  return { key, type: 'changed', oldValue: 1, newValue: 2 } as DiffNode
}

/** A nested chain N levels deep, each level holding one nested child. */
function nestedChain(depth: number, key = 'lvl'): DiffNode {
  if (depth === 0) return changed(`${key}-leaf`)
  return {
    key: `${key}-${depth}`,
    type: 'nested',
    children: [nestedChain(depth - 1, key)],
  } as DiffNode
}

describe('DiffTreeView render budget', () => {
  afterEach(cleanup)

  it('renders a small change set in full', () => {
    render(DiffTreeView, { nodes: [changed('a'), changed('b')] })
    expect(screen.getByText('a:')).toBeTruthy()
    expect(screen.getByText('b:')).toBeTruthy()
    expect(screen.queryByText(/not shown/)).toBeNull()
  })

  it('caps a wide change set and says how much it hid', () => {
    // This renderer had NO cap and default-expanded every nested node at every
    // level, so opening Diff on a wide change set mounted the whole tree
    // synchronously on the host app's main thread.
    const nodes = Array.from({ length: 120 }, (_, i) => changed(`key${i}`))
    render(DiffTreeView, { nodes })

    expect(screen.getByText('key0:')).toBeTruthy()
    expect(screen.queryByText('key119:')).toBeNull()
    expect(screen.getByText(/70 more changes not shown/)).toBeTruthy()
  })

  it('stops auto-expanding past the depth limit', () => {
    // A {region: {day: {...}}} shape — metrics dashboards, i18n bundles —
    // multiplies out if every level opens itself.
    render(DiffTreeView, { nodes: [nestedChain(5)] })
    expect(screen.queryByText('lvl-leaf:')).toBeNull()
  })

  it('still auto-expands the first levels, where the useful diff is', () => {
    render(DiffTreeView, { nodes: [nestedChain(1)] })
    expect(screen.getByText('lvl-leaf:')).toBeTruthy()
  })

  it('reports no changes rather than an empty box', () => {
    render(DiffTreeView, { nodes: [{ key: 'x', type: 'unchanged', oldValue: 1, newValue: 1 } as DiffNode] })
    expect(screen.getByText('No changes')).toBeTruthy()
  })
})
