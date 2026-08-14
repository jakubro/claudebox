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
  const { reconnectSSE } = useEvents()
  const { clearSessionData } = useSessionActions()
  const { clearStash } = useStash()
  const { navigateToWorkspace } = useSessionRouting()
  const prevRef = useRef(workspaceId)

  useEffect(() => {
    if (prevRef.current && prevRef.current !== workspaceId && workspaceId) {
      navigateToWorkspace(workspaceId)
      clearSessionData()
      clearStash()
      reconnectSSE()
    }
    prevRef.current = workspaceId
  }, [workspaceId, navigateToWorkspace, clearSessionData, clearStash, reconnectSSE])

  return null
}
