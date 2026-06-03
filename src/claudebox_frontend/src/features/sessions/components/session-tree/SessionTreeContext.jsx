/** Context for stable session tree state shared across recursive SessionTree nodes. */

import { createContext, useMemo } from 'react'

export const SessionTreeContext = createContext(null)

/**
 * Provide stable session tree state for recursive SessionTree nodes.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {Map} props.childrenMap - Map of parent session ID to child sessions.
 * @param {Set} props.expandedSessions - Set of expanded session IDs.
 * @param {string} props.currentSessionId - Currently active session ID.
 * @param {Set<string>} props.pinnedSessions - Set of pinned session IDs (O(1) lookup).
 * @param {function} props.onResume - Callback when resuming a session.
 * @param {function} props.onRename - Callback when renaming a session.
 * @param {function} props.onTogglePin - Callback when toggling pin state.
 * @param {function} props.onToggleExpanded - Callback when expanding/collapsing.
 * @param {function} props.onKillContainer - Callback when killing a session's container.
 * @param {function} props.onOpenInNewTab - Callback when opening a session in a new browser tab.
 */
export function SessionTreeProvider({
  children,
  childrenMap,
  expandedSessions,
  currentSessionId,
  pinnedSessions,
  onResume,
  onRename,
  onTogglePin,
  onToggleExpanded,
  onKillContainer,
  onOpenInNewTab,
}) {
  const value = useMemo(
    () => ({
      childrenMap,
      expandedSessions,
      currentSessionId,
      pinnedSessions,
      onResume,
      onRename,
      onTogglePin,
      onToggleExpanded,
      onKillContainer,
      onOpenInNewTab,
    }),
    [
      childrenMap,
      expandedSessions,
      currentSessionId,
      pinnedSessions,
      onResume,
      onRename,
      onTogglePin,
      onToggleExpanded,
      onKillContainer,
      onOpenInNewTab,
    ],
  )

  return <SessionTreeContext.Provider value={value}>{children}</SessionTreeContext.Provider>
}
