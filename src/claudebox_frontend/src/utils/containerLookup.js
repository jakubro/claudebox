/** Pure session-to-container id resolvers. */

/**
 * Session id for a container: check the eager containerMap first (set at creation), else the sessions list.
 * @param {string} containerId
 * @param {Object<string, string>} containerMap - sessionId -> containerId.
 * @param {Array<{session_id: string, container_id?: string}>} sessions
 * @returns {string | null}
 */
export function resolveSessionIdFromContainer(containerId, containerMap, sessions) {
  const fromMap = Object.entries(containerMap).find(([, cid]) => cid === containerId)?.[0]
  if (fromMap) {
    return fromMap
  }
  return sessions.find(s => s.container_id === containerId)?.session_id ?? null
}

/**
 * Container id for a session: check the eager containerMap first (set at creation), else the sessions list.
 * @param {string} sessionId
 * @param {Object<string, string>} containerMap - sessionId -> containerId.
 * @param {Array<{session_id: string, container_id?: string}>} sessions
 * @returns {string | null}
 */
export function resolveContainerId(sessionId, containerMap, sessions) {
  const fromMap = containerMap[sessionId]
  if (fromMap) {
    return fromMap
  }
  return sessions.find(s => s.session_id === sessionId)?.container_id ?? null
}
