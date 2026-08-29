/** Derive the session rail's rendered groups, ancestry, and focus-move navigation. */

import { useEffect, useMemo } from 'react'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import {
  capAncestors,
  deriveAncestorChain,
  deriveVisitedPath,
  railTailStorageKey,
  readStoredPath,
  writeStoredPath,
} from '../utils/sessionRail'

/**
 * The session rail's own state: the full ancestry chain, the capped set of groups actually
 * rendered, and focus-move navigation over that rendered order.
 *
 * @returns {{
 *   chain: string[],
 *   renderedGroups: {sessionId: string, isFocused: boolean, isRoot: boolean}[],
 *   focusedSessionId: string|null,
 *   focusPrev: (() => void)|null,
 *   focusNext: (() => void)|null,
 * }}
 */
export default function useSessionRail() {
  const { sessions } = useSessionsList()
  const { activeSessionId, navigateToSession } = useSessionRouting()
  const { workspaceId } = useWorkspace()

  const chain = useMemo(
    () => deriveAncestorChain(sessions, activeSessionId),
    [sessions, activeSessionId],
  )

  const storageKey = chain.length > 0 ? railTailStorageKey(chain[0]) : null

  // Unmemoized on purpose: memoizing on storageKey would freeze this at its first value and never
  // pick up the write-back effect below. The key changes mid-tree - a fork starts its own chain.
  const storedPath = storageKey ? readStoredPath(storageKey) : []

  const { visitedPath, tail } = useMemo(
    () => (chain.length > 0 ? deriveVisitedPath(chain, storedPath) : { visitedPath: [], tail: [] }),
    [chain, storedPath],
  )

  useEffect(() => {
    if (storageKey && visitedPath.length > 0) {
      writeStoredPath(storageKey, visitedPath)
    }
  }, [storageKey, visitedPath])

  const renderedAncestors = useMemo(() => capAncestors(chain), [chain])

  const renderedGroups = useMemo(() => {
    if (chain.length === 0) {
      return []
    }

    const focusedId = chain[chain.length - 1]
    const rootId = chain[0]

    return [...renderedAncestors, focusedId, ...tail].map(sessionId => ({
      sessionId,
      isFocused: sessionId === focusedId,
      isRoot: sessionId === rootId,
    }))
  }, [chain, renderedAncestors, tail])

  const focusedSessionId = chain.length > 0 ? chain[chain.length - 1] : null

  const moveFocus = useMemo(() => {
    const order = renderedGroups.map(g => g.sessionId)
    const index = order.indexOf(focusedSessionId)

    const step = delta => {
      const nextIndex = index + delta
      const target = order[nextIndex]
      if (target && workspaceId) {
        navigateToSession(workspaceId, target)
      }
    }

    return {
      prev: index > 0 ? () => step(-1) : null,
      next: index >= 0 && index < order.length - 1 ? () => step(1) : null,
    }
  }, [renderedGroups, focusedSessionId, workspaceId, navigateToSession])

  return {
    chain,
    renderedGroups,
    focusedSessionId,
    focusPrev: moveFocus.prev,
    focusNext: moveFocus.next,
  }
}
