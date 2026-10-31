/** Context for stable session tree state shared across SessionTree nodes. */

// audit-ignore-file: excessive-props

import { createContext, useMemo } from 'react'

export const SessionTreeContext = createContext(null)

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} props.currentSessionId - Currently active session ID.
 * @param {Set<string>} props.pinnedSessions - Set of pinned session IDs (O(1) lookup).
 * @param {function} props.deriveSessionStatus - Container status for a session's dot.
 * @param {function} props.onResume - Callback when resuming a session.
 * @param {function} props.onRename - Callback when renaming a session.
 * @param {function} props.onTogglePin - Callback when toggling pin state.
 * @param {function} props.onToggleExpanded - Callback when expanding/collapsing.
 * @param {function} props.onKillContainer - Callback when killing a session's container.
 * @param {function} props.onOpenInNewTab - Callback when opening a session in a new browser tab.
 */
export function SessionTreeProvider({
  children,
  currentSessionId,
  pinnedSessions,
  deriveSessionStatus,
  onResume,
  onRename,
  onTogglePin,
  onToggleExpanded,
  onKillContainer,
  onOpenInNewTab,
}) {
  const value = useMemo(
    () => ({
      currentSessionId,
      pinnedSessions,
      deriveSessionStatus,
      onResume,
      onRename,
      onTogglePin,
      onToggleExpanded,
      onKillContainer,
      onOpenInNewTab,
    }),
    [
      currentSessionId,
      pinnedSessions,
      deriveSessionStatus,
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
