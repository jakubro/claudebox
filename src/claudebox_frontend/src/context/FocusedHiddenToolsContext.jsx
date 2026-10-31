/** The workspace's tools hidden from Focused by hand - one instance for every tool block. */

import { createContext, useContext, useMemo } from 'react'
import useFocusedHiddenTools from '../hooks/useFocusedHiddenTools'
import { useWorkspace } from './WorkspaceContext'

const FocusedHiddenToolsContext = createContext(null)

/**
 * A context of its own, so a session-list refetch never re-renders tool blocks.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function FocusedHiddenToolsProvider({ children }) {
  const { workspaceId } = useWorkspace()
  const { hiddenTools, markTool, unmarkTools } = useFocusedHiddenTools(workspaceId)
  const value = useMemo(
    () => ({ hiddenTools, markTool, unmarkTools }),
    [hiddenTools, markTool, unmarkTools],
  )

  return (
    <FocusedHiddenToolsContext.Provider value={value}>
      {children}
    </FocusedHiddenToolsContext.Provider>
  )
}

/** The marks and their writers, or null outside a provider - for views also rendered standalone. */
export function useOptionalFocusedHiddenTools() {
  return useContext(FocusedHiddenToolsContext)
}
