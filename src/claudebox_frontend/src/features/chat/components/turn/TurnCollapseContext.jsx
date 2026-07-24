/** Central turn-collapse state (collapsed set + per-turn toggle) shared across the whole turn list. */

import { createContext, useMemo } from 'react'

export const TurnCollapseContext = createContext(null)

/**
 * Provide central turn-collapse state to the turn list.
 *
 * Owned above the turn list (ChatPanel) so a single control can drive every
 * turn's collapse without threading props through the memoized historical list.
 * Consumed by Turn via useTurnCollapse(); Turn falls back to local collapse
 * state when no provider is present (standalone rendering, pending turns).
 *
 * @param {Object} props
 * @param {Set<string>} props.collapsedTurnIds - Currently-collapsed turn ids.
 * @param {Function} props.onToggleTurnCollapse - Toggle one turn's collapse: (turnId) => void.
 * @param {React.ReactNode} props.children - Child components.
 */
export function TurnCollapseProvider({ collapsedTurnIds, onToggleTurnCollapse, children }) {
  const value = useMemo(
    () => ({ collapsedTurnIds, onToggleTurnCollapse }),
    [collapsedTurnIds, onToggleTurnCollapse],
  )

  return <TurnCollapseContext.Provider value={value}>{children}</TurnCollapseContext.Provider>
}
