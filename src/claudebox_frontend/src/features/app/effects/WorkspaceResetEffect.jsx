/** Reset all workspace-scoped state when the active workspace changes. */

import { useEffect, useRef } from 'react'
import { useEvents } from '../../../context/EventsContext'
import { useSessionActions } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useStash } from '../../../context/StashContext'
import { useWorkspace } from '../../../context/WorkspaceContext'

/** Placed inside all providers so it can access every workspace-scoped context. */
export default function WorkspaceResetEffect() {
  const { workspaceId } = useWorkspace()
  const { closeSSE } = useEvents()
  const { clearSessionData } = useSessionActions()
  const { clearStash } = useStash()
  const { navigateToWorkspace, activeWorkspaceId } = useSessionRouting()
  const prevRef = useRef(workspaceId)

  useEffect(() => {
    if (prevRef.current && prevRef.current !== workspaceId && workspaceId) {
      // A switch made by following a link already addresses the new workspace; keep what it names.
      if (activeWorkspaceId !== workspaceId) {
        navigateToWorkspace(workspaceId)
      }
      clearSessionData()
      clearStash()
      // A switch always leaves the session; a cross-workspace open resumes and reconnects itself.
      closeSSE()
    }
    prevRef.current = workspaceId
  }, [workspaceId, activeWorkspaceId, navigateToWorkspace, clearSessionData, clearStash, closeSSE])

  return null
}
