/** Open another session at a jump target; leaving one mid-answer shows the still-running toast. */

import { useCallback } from 'react'
import { useEvents } from '../context/EventsContext'
import { useSessionData } from '../context/SessionDataContext'
import { useSessionRouting } from '../context/SessionRoutingContext'
import { useStillRunningToast } from '../context/StillRunningToastContext'
import { useWorkspace } from '../context/WorkspaceContext'

/** Return `switchToSession(sessionId, jumpOptions)`. */
export default function useSwitchToSession() {
  const { sessionId, sessionName } = useSessionData()
  const { isResponding } = useEvents()
  const { navigateToSession } = useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { showStillRunningToast } = useStillRunningToast()

  return useCallback(
    (targetId, jumpOptions) => {
      if (!workspaceId) {
        return
      }
      // Snapshot the session left behind before navigating - the toast needs it after the switch.
      const prevId = sessionId
      const prevName = sessionName
      const prevWasResponding = isResponding
      navigateToSession(workspaceId, targetId, jumpOptions)
      if (prevWasResponding && prevId && prevId !== targetId) {
        showStillRunningToast({
          sessionName: prevName || prevId.slice(0, 8),
          onReturn: () => navigateToSession(workspaceId, prevId),
        })
      }
    },
    [sessionId, sessionName, isResponding, workspaceId, navigateToSession, showStillRunningToast],
  )
}
