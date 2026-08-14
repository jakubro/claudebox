/** Central turn-collapse state (collapsed set + per-turn toggle) shared across the whole turn list. */

import { createContext, useMemo } from 'react'

export const TurnCollapseContext = createContext(null)

/**
 * Owned above the turn list so one control drives collapse without prop-threading through the memoized list.
 * Falls back to local state via useTurnCollapse() with no provider (standalone rendering, pending turns).
 * @param {Set<string>} props.collapsedTurnIds - Currently-collapsed turn ids.
 * @param {Function} props.onToggleTurnCollapse - Toggle one turn's collapse: (turnId) => void.
 */
export function TurnCollapseProvider({ collapsedTurnIds, onToggleTurnCollapse, children }) {
  const value = useMemo(
    () => ({ collapsedTurnIds, onToggleTurnCollapse }),
    [collapsedTurnIds, onToggleTurnCollapse],
  )

  return <TurnCollapseContext.Provider value={value}>{children}</TurnCollapseContext.Provider>
}
