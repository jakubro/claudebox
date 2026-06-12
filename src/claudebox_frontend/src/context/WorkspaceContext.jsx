/** Workspace discovery and selection state. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setWorkspaceId } from '../api/apiClient'
import { WORKSPACE_STORAGE_KEY } from '../config/storage'
import { parseHash } from './utils/sessionRouting'

export const WorkspaceContext = createContext(null)

/** Fetch the registered-workspace list from the daemon. */
async function fetchWorkspaces() {
  const res = await fetch('/api/workspaces')
  if (!res.ok) {
    throw new Error('Failed to fetch workspaces')
  }
  const data = await res.json()
  return data.workspaces || []
}

/** Discover registered workspaces and maintain the active selection. */
export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([])
  const [workspaceId, setWorkspaceIdState] = useState(null)
  const [loading, setLoading] = useState(true)

  const selectWorkspace = useCallback(id => {
    setWorkspaceIdState(id)
    setWorkspaceId(id)
    if (id) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, id)
    }
  }, [])

  /** Refetch workspaces; reconcile active selection if it disappeared. */
  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await fetchWorkspaces()
      setWorkspaces(list)
      if (workspaceId && !list.find(w => w.id === workspaceId)) {
        selectWorkspace(list[0]?.id ?? null)
      }
      return list
    } catch {
      // Daemon transient - leave existing state.
      return null
    }
  }, [workspaceId, selectWorkspace])

  useEffect(() => {
    async function discover() {
      try {
        const list = await fetchWorkspaces()
        setWorkspaces(list)

        if (list.length === 1) {
          selectWorkspace(list[0].id)
        } else if (list.length > 1) {
          // Priority: hash > localStorage > first workspace
          const hashRoute = parseHash(window.location.hash)
          const hashMatch = hashRoute && list.find(w => w.id === hashRoute.workspaceId)

          if (hashMatch) {
            selectWorkspace(hashMatch.id)
          } else {
            const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY)
            const storedMatch = list.find(w => w.id === stored)
            selectWorkspace(storedMatch ? storedMatch.id : list[0].id)
          }
        }
      } catch {
        // Daemon not available - expected in single-container mode
      } finally {
        setLoading(false)
      }
    }

    discover()
  }, [selectWorkspace])

  const value = useMemo(
    () => ({ workspaceId, workspaces, selectWorkspace, refreshWorkspaces, loading }),
    [workspaceId, workspaces, selectWorkspace, refreshWorkspaces, loading],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

/** Access workspace discovery state. */
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider')
  }
  return context
}
