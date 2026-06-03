/** Turn-scoped context for data shared across Turn, ToolBlock, and ToolBlockExpandedContent. */

import { createContext, useMemo } from 'react'

export const TurnContext = createContext(null)

/**
 * Provide turn-scoped data to child components.
 * @param {Object} props
 * @param {boolean} props.hasNextUserMessage - Whether another user message follows.
 * @param {boolean} props.nextUserMessageIsFormResponse - Whether next message is form response.
 * @param {string} props.nextUserMessage - Content of next user message.
 * @param {boolean} props.hasPendingMessages - Whether pending messages exist.
 * @param {Map} props.todoDiffs - Todo changes keyed by tool_use_id.
 * @param {Object} props.taskNotifications - Task completion notifications.
 * @param {Function} props.onFormSubmit - Callback for form submission.
 * @param {number} props.turnStartTime - Turn start timestamp in ms.
 * @param {number} props.now - Current time in ms for live-ticking.
 * @param {boolean} props.isActiveTurn - Whether parent turn is active.
 * @param {React.ReactNode} props.children - Child components.
 */
export function TurnProvider({
  hasNextUserMessage,
  nextUserMessageIsFormResponse,
  nextUserMessage,
  hasPendingMessages,
  todoDiffs,
  taskNotifications,
  onFormSubmit,
  turnStartTime,
  now,
  isActiveTurn,
  children,
}) {
  const value = useMemo(
    () => ({
      hasNextUserMessage,
      nextUserMessageIsFormResponse,
      nextUserMessage,
      hasPendingMessages,
      todoDiffs,
      taskNotifications,
      onFormSubmit,
      turnStartTime,
      now,
      isActiveTurn,
    }),
    [
      hasNextUserMessage,
      nextUserMessageIsFormResponse,
      nextUserMessage,
      hasPendingMessages,
      todoDiffs,
      taskNotifications,
      onFormSubmit,
      turnStartTime,
      now,
      isActiveTurn,
    ],
  )

  return <TurnContext.Provider value={value}>{children}</TurnContext.Provider>
}
