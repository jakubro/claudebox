/** Pure session ↔ container resolvers - extracted from multiple effects + components. */

/**
 * Find the session id for a container, checking the eager containerMap first
 * (populated at session creation) then the canonical sessions list.
 *
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
 * Find the container id for a session, checking the eager containerMap first
 * (populated at session creation) then the canonical sessions list.
 *
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
