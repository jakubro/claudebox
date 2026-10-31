/** Shared session resume and SSE reconnection logic. */

import { setAddress } from '../../../api/apiClient'
import { resumeSession } from '../../../api/sessions'

/**
 * @param {Object} deps
 * @param {string} deps.activeSessionId - Session to resume.
 * @param {Function} deps.isStillActive - Re-checked after the resume call returns, before any
 *   write; a resume resolving after the reader switched sessions discards its result instead.
 * @param {Function} deps.startResume - Raise "Resuming"; returns the open request's token.
 * @param {Function} deps.settleResumeRequest - Settle that request, just before the reconnect.
 * @param {Function} deps.reconnectSSE - Reconnect the container SSE stream.
 * @param {Function} deps.notifyAddressChanged - Notify listeners of a new address.
 * @param {Function} deps.setSessionContainer - Persist the session-to-container mapping.
 * @param {Function} deps.clearSessionData - Clear stale session data.
 * @param {Function} deps.onError - Called with the caught error on failure.
 */
export async function resumeAndReconnect({
  activeSessionId,
  isStillActive,
  startResume,
  settleResumeRequest,
  reconnectSSE,
  notifyAddressChanged,
  setSessionContainer,
  clearSessionData,
  onError,
}) {
  const token = startResume()
  try {
    const data = await resumeSession(activeSessionId)
    if (!isStillActive()) {
      return
    }
    if (data?.container_id) {
      setAddress(data.container_id, activeSessionId)
      notifyAddressChanged()
      setSessionContainer(activeSessionId, data.container_id)
    }
    clearSessionData()
    settleResumeRequest(token)
    reconnectSSE()
  } catch (error) {
    if (!isStillActive()) {
      return
    }
    onError(error)
  }
}
