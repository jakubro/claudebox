/** Turn-scoped context for data shared across Turn, ToolBlock, and ToolBlockExpandedContent. */

// audit-ignore-file: excessive-props

import { createContext, useMemo } from 'react'

export const TurnContext = createContext(null)

/**
 * @param {string|null} props.sessionId - Session the blocks read files from; null for the chat's.
 * @param {Map} props.todoDiffs - Todo changes keyed by tool_use_id.
 * @param {function} [props.onFormSubmit] - (answer); absent when read-only, disabling forms.
 * @param {number} props.turnStartTime - Turn start timestamp in ms.
 * @param {number} props.now - Current time in ms for live-ticking.
 * @param {string} [props.turnId] - Set only where parts and tool calls can be bookmarked.
 * @param {Set<string>} [props.bookmarkedParts] - The turn's bookmarked part and tool-call tails.
 * @param {function} [props.onToggleBookmark] - (turnId, tail, preview).
 */
export function TurnProvider({
  sessionId,
  hasNextUserMessage,
  nextUserMessageIsFormResponse,
  nextUserMessage,
  hasPendingMessages,
  todoDiffs,
  taskNotifications,
  onFormSubmit,
  registerPendingForm,
  turnStartTime,
  now,
  isActiveTurn,
  turnId = null,
  bookmarkedParts = null,
  onToggleBookmark = null,
  children,
}) {
  const value = useMemo(
    () => ({
      sessionId,
      hasNextUserMessage,
      nextUserMessageIsFormResponse,
      nextUserMessage,
      hasPendingMessages,
      todoDiffs,
      taskNotifications,
      onFormSubmit,
      registerPendingForm,
      turnStartTime,
      now,
      isActiveTurn,
      turnId,
      bookmarkedParts,
      onToggleBookmark,
    }),
    [
      sessionId,
      hasNextUserMessage,
      nextUserMessageIsFormResponse,
      nextUserMessage,
      hasPendingMessages,
      todoDiffs,
      taskNotifications,
      onFormSubmit,
      registerPendingForm,
      turnStartTime,
      now,
      isActiveTurn,
      turnId,
      bookmarkedParts,
      onToggleBookmark,
    ],
  )

  return <TurnContext.Provider value={value}>{children}</TurnContext.Provider>
}
