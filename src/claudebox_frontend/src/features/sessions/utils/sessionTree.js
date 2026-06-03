/** Session tree building utilities. */

/**
 * Build session tree grouping children under parents.
 *
 * Filters empty sessions, groups by parent_session_id, sorts pinned first
 * then by max descendant timestamp.
 */
export function buildSessionTree(sessions, pinnedSessions, currentSessionId) {
  const pinnedSet = new Set(pinnedSessions)
  const childrenMap = new Map()
  const rootSessions = []

  // Filter out empty sessions (no human messages), keep active session
  const visible = sessions.filter(
    s => s.num_turns > 0 || s.container_id || s.session_id === currentSessionId,
  )

  // First pass: group children under parents (pinned forks appear in both places)
  for (const session of visible) {
    if (session.parent_session_id) {
      const children = childrenMap.get(session.parent_session_id) || []
      children.push(session)
      childrenMap.set(session.parent_session_id, children)
    }
    if (!session.parent_session_id || pinnedSet.has(session.session_id)) {
      rootSessions.push(session)
    }
  }

  // Compute max timestamp across a session and all its descendants
  const getMaxTimestamp = session => {
    const own = session.updated_at || session.started_at || ''
    const children = childrenMap.get(session.session_id) || []
    return children.reduce((max, child) => {
      const childMax = getMaxTimestamp(child)
      return childMax > max ? childMax : max
    }, own)
  }

  // Sort: pinned first → unpinned with container → unpinned without, each by timestamp desc
  const byTimestamp = (a, b) => {
    const ta = getMaxTimestamp(a)
    const tb = getMaxTimestamp(b)
    return ta > tb ? -1 : ta < tb ? 1 : 0
  }

  const sortSessions = list => {
    const pinned = list.filter(s => pinnedSet.has(s.session_id))
    const unpinned = list.filter(s => !pinnedSet.has(s.session_id))
    const withContainer = unpinned.filter(s => s.container_id).sort(byTimestamp)
    const withoutContainer = unpinned.filter(s => !s.container_id).sort(byTimestamp)
    return [...pinned, ...withContainer, ...withoutContainer]
  }

  return {
    rootSessions: sortSessions(rootSessions),
    childrenMap,
  }
}
