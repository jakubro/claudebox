/** Pure hash-routing parser - extracted utility for SessionRoutingContext.jsx, no React APIs. */

/**
 * Parse hash into workspace and optional session/board IDs and per-viewer params.
 *
 * Session route may carry an optional `/turns/<role>-<turnId>` segment (`u` = user, `a` =
 * assistant) that serializes a paused-at-turn reading position; absence means "at bottom,
 * autoscroll engaged". An assistant segment may name one bookmarked part after it,
 * `/turns/a-<turnId>/<p-...|tool-...>`.
 *
 * @param {string} hash - Window location hash.
 * @returns {{ workspaceId: string, sessionId: string | null, boardId: string | null, turnId: string | null, messageType: 'user' | 'assistant' | null, target: string | null, density: 'comfortable' | 'terse', sendMessages: string[] } | null}
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
      target: null,
      density,
      sendMessages: [],
    }
  }

  // Session route: #/workspaces/{id}[/sessions/{sessionId}[/turns/(u|a)-{turnId}[/{part}]]]
  const match = hashPath.match(
    /^#\/workspaces\/([a-zA-Z0-9_.-]+)(?:\/sessions\/([a-zA-Z0-9_-]+)(?:\/turns\/(u|a)-([a-zA-Z0-9_-]+)(?:\/((?:p|tool)-[a-zA-Z0-9_-]+))?)?)?$/,
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
    target: match[3] === 'a' ? (match[5] ?? null) : null,
    density,
    // Carried first-message text - only the workspace-only form honors it (never session/board).
    sendMessages: match[2] ? [] : params.getAll('send'),
  }
}

/**
 * Build the `/turns/<role>-<turnId>[/<part>]` segment for a URL; empty string when either of the
 * first two is missing - a bare session URL means "at bottom, autoscroll engaged".
 *
 * @param {string | null | undefined} turnId
 * @param {'user' | 'assistant' | null | undefined} messageType
 * @param {string | null} [target] - A part or tool-call tail; kept only on an assistant segment
 * @returns {string}
 */
export function buildTurnSegment(turnId, messageType, target = null) {
  if (!(turnId && messageType)) {
    return ''
  }
  const rolePrefix = messageType === 'user' ? 'u' : 'a'
  const part = target && messageType !== 'user' ? `/${target}` : ''
  return `/turns/${rolePrefix}-${turnId}${part}`
}
