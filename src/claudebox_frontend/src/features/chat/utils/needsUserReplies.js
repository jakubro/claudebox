/** Which replies an agent's ask offers as one-click buttons on the newest turn. */

import { EventSubtype, normalizeToolName, ToolName } from '../../../config/schema'

const FORM_TOOLS = new Set([ToolName.ASK_USER_QUESTION, ToolName.EXIT_PLAN_MODE])

/**
 * Return the replies to show as buttons, or null. Session data refreshes lag the event stream, so
 * the stored replies count only while the turn's own last top-level ask is a needs_user call.
 * @param {object|null} sessionData - The session's stored summary
 * @param {string|null} activeSessionId - Session the tab shows
 * @param {Array} [events] - The newest turn's events
 * @param {boolean} hasPending - Whether a sent message is still awaiting confirmation
 */
export function activeTurnReplies(sessionData, activeSessionId, events, hasPending) {
  const replies = sessionData?.needs_user_replies
  if (
    !(sessionData?.needs_user && replies?.length) ||
    sessionData.session_id !== activeSessionId ||
    hasPending
  ) {
    return null
  }
  const lastAsk = events?.findLast(
    e =>
      e.subtype === EventSubtype.TOOL_USE &&
      !e.parent_tool_use_id &&
      (normalizeToolName(e.content) === ToolName.NEEDS_USER ||
        FORM_TOOLS.has(normalizeToolName(e.content))),
  )
  return lastAsk && normalizeToolName(lastAsk.content) === ToolName.NEEDS_USER ? replies : null
}
