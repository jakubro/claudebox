/** Tests for SessionTree passthrough continuation lines. */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { flattenSessionTree } from '../../utils/sessionTree'
import SessionTree from './SessionTree'
import { SessionTreeProvider } from './SessionTreeContext'

/** Render a tree's flattened rows as SessionTree nodes inside the context provider. */
function renderTree(sessions, { childrenMap, expandedSessions = new Set() } = {}) {
  const rows = flattenSessionTree(
    { rootSessions: sessions, childrenMap: childrenMap || new Map() },
    expandedSessions,
  )
  return render(
    <SessionTreeProvider
      currentSessionId="s1"
      pinnedSessions={new Set()}
      deriveSessionStatus={() => 'none'}
      onResume={vi.fn()}
      onRename={vi.fn()}
      onTogglePin={vi.fn()}
      onToggleExpanded={vi.fn()}>
      {rows.map(row => (
        <SessionTree
          key={row.key}
          session={row.session}
          depth={row.depth}
          isLastChild={row.isLastChild}
          continuations={row.continuations}
          hasChildren={row.hasChildren}
          isExpanded={row.isExpanded}
        />
      ))}
    </SessionTreeProvider>,
  )
}

describe('SessionTree', () => {
  describe('passthrough continuation lines', () => {
    it('non-last root does not propagate passthrough line to children', () => {
      const root1 = { session_id: 's1', title: 'Root 1' }
      const root2 = { session_id: 's2', title: 'Root 2' }
      const child = { session_id: 'c1', title: 'Child 1' }

      const childrenMap = new Map([['s1', [child]]])

      renderTree([root1, root2], {
        childrenMap,
        expandedSessions: new Set(['s1']),
      })

      // Child row should have no active passthrough gutter at depth 0
      const passthroughs = document.querySelectorAll('.sessions-tree-gutter-passthrough')
      expect(passthroughs).toHaveLength(0)
    })

    it('non-last nested child propagates passthrough line to its children', () => {
      const root = { session_id: 's1', title: 'Root' }
      const child1 = { session_id: 'c1', title: 'Child 1' }
      const child2 = { session_id: 'c2', title: 'Child 2' }
      const grandchild = { session_id: 'g1', title: 'Grandchild' }

      const childrenMap = new Map([
        ['s1', [child1, child2]],
        ['c1', [grandchild]],
      ])

      renderTree([root], {
        childrenMap,
        expandedSessions: new Set(['s1', 'c1']),
      })

      // Grandchild row should have an active passthrough at depth 1 (from non-last child1)
      const passthroughs = document.querySelectorAll('.sessions-tree-gutter-passthrough')
      expect(passthroughs.length).toBeGreaterThan(0)
    })

    it('last child does not propagate passthrough line', () => {
      const root = { session_id: 's1', title: 'Root' }
      const child = { session_id: 'c1', title: 'Only Child' }
      const grandchild = { session_id: 'g1', title: 'Grandchild' }

      const childrenMap = new Map([
        ['s1', [child]],
        ['c1', [grandchild]],
      ])

      renderTree([root], {
        childrenMap,
        expandedSessions: new Set(['s1', 'c1']),
      })

      // Only child -> no passthrough lines (all empty spacers)
      const passthroughs = document.querySelectorAll('.sessions-tree-gutter-passthrough')
      expect(passthroughs).toHaveLength(0)
    })
  })
})
