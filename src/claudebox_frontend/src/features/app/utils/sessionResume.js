/** Shared session resume and SSE reconnection logic. */

import { setContainerId } from '../../../api/apiClient'
import { resumeSession } from '../../../api/sessions'

/**
 * @param {Object} deps
 * @param {string} deps.activeSessionId - Session to resume.
 * @param {Function} deps.startResume - Signal that resume is in progress.
 * @param {Function} deps.reconnectSSE - Reconnect the container SSE stream.
 * @param {Function} deps.notifyContainerChanged - Notify listeners of a new container.
 * @param {Function} deps.setSessionContainer - Persist the session-to-container mapping.
 * @param {Function} deps.clearSessionData - Clear stale session data.
 * @param {Function} deps.onError - Called with the caught error on failure.
 */
export async function resumeAndReconnect({
  activeSessionId,
  startResume,
  reconnectSSE,
  notifyContainerChanged,
  setSessionContainer,
  clearSessionData,
  onError,
}) {
  startResume()
  try {
    const data = await resumeSession(activeSessionId)
    if (data?.container_id) {
      setContainerId(data.container_id)
      notifyContainerChanged()
      setSessionContainer(activeSessionId, data.container_id)
    }
    clearSessionData()
    reconnectSSE()
  } catch (error) {
    onError(error)
  }
}
