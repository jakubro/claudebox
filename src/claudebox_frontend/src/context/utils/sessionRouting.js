/** Pure hash-routing parser — extracted utility for SessionRoutingContext.jsx, no React APIs. */

/**
 * Parse hash into workspace and optional session/board IDs and per-viewer params.
 *
 * Session route may carry an optional `/turns/<role>-<turnId>` segment where
 * role is `u` (user message) or `a` (assistant message). The segment serializes
 * a paused-at-turn reading position; absence means "at bottom, autoscroll engaged".
 *
 * @param {string} hash - Window location hash.
 * @returns {{ workspaceId: string, sessionId: string | null, boardId: string | null, turnId: string | null, messageType: 'user' | 'assistant' | null, density: 'comfortable' | 'terse' } | null}
 */
export function parseHash(hash) {
  const hashPath = hash.split('?')[0]
  const queryStr = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const params = new URLSearchParams(queryStr)
  const density = params.get('density') === 'terse' ? 'terse' : 'comfortable'

  // Board route: #/workspaces/{id}/boards/{boardId}
  const boardMatch = hashPath.match(/^#\/workspaces\/([a-zA-Z0-9_.-]+)\/boards\/([a-zA-Z0-9_.-]+)$/)
  if (boardMatch) {
    return {
      workspaceId: boardMatch[1],
      sessionId: null,
      boardId: boardMatch[2],
      turnId: null,
      messageType: null,
      density,
    }
  }

  // Session route: #/workspaces/{id}[/sessions/{sessionId}[/turns/(u|a)-{turnId}]]
  const match = hashPath.match(
    /^#\/workspaces\/([a-zA-Z0-9_.-]+)(?:\/sessions\/([a-zA-Z0-9_-]+)(?:\/turns\/(u|a)-([a-zA-Z0-9_-]+))?)?$/,
  )
  if (!match) {
    return null
  }
  return {
    workspaceId: match[1],
    sessionId: match[2] ?? null,
    boardId: null,
    turnId: match[4] ?? null,
    messageType: match[3] === 'u' ? 'user' : match[3] === 'a' ? 'assistant' : null,
    density,
  }
}

/**
 * Build the `/turns/<role>-<turnId>` segment for a URL. Returns empty string when
 * either input is missing — a bare session URL means "at bottom, autoscroll engaged".
 *
 * @param {string | null | undefined} turnId
 * @param {'user' | 'assistant' | null | undefined} messageType
 * @returns {string}
 */
export function buildTurnSegment(turnId, messageType) {
  if (!(turnId && messageType)) {
    return ''
  }
  const rolePrefix = messageType === 'user' ? 'u' : 'a'
  return `/turns/${rolePrefix}-${turnId}`
}
