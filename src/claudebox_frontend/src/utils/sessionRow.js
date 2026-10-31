/** A session's dot state and its hover text, shared by every surface that draws a session's dot. */

// Highest first; a collapsed row takes one of these from a fork it hides.
export const SESSION_STATES = ['working', 'needs-you', 'waiting']

export const DOT_TITLES = {
  stopping: 'Stopping container...',
  running: 'Container running',
  none: 'No container',
  'needs-you': 'Needs you',
  working: 'Working',
  waiting: 'Waiting on background work',
}

/**
 * What a session's row shows: `status` from its container, the `dot` - its own state, or a hidden
 * fork's that ranks higher in `SESSION_STATES` - and `reason`, set while its own dot says it needs you.
 */
export function sessionRowDisplay(session, deriveSessionStatus, hiddenSessions = []) {
  const statusOf = s => deriveSessionStatus(s.session_id, undefined, s.container_id)
  const status = statusOf(session)
  const own = sessionDotState(status, session)
  const hidden = hiddenSessions.map(s => sessionDotState(statusOf(s), s))
  const dot =
    own === 'stopping' ? own : (SESSION_STATES.find(s => s === own || hidden.includes(s)) ?? own)

  return { status, dot, reason: own === 'needs-you' ? session.needs_user : null }
}

/** A session's dot state: its agent's activity while its container runs, else the container status. */
export function sessionDotState(status, session) {
  if (status !== 'running') {
    return status
  }
  if (session?.activity === 'working') {
    return 'working'
  }
  if (session?.needs_user) {
    return 'needs-you'
  }
  return session?.activity === 'waiting' ? 'waiting' : 'running'
}
