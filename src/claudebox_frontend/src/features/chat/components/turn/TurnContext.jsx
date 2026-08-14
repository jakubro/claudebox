/** Turn-scoped context for data shared across Turn, ToolBlock, and ToolBlockExpandedContent. */

// audit-ignore-file: excessive-props

import { createContext, useMemo } from 'react'

export const TurnContext = createContext(null)

/**
 * @param {Map} props.todoDiffs - Todo changes keyed by tool_use_id.
 * @param {number} props.turnStartTime - Turn start timestamp in ms.
 * @param {number} props.now - Current time in ms for live-ticking.
 */
export function TurnProvider({
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
      registerPendingForm,
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
      registerPendingForm,
      turnStartTime,
      now,
      isActiveTurn,
    ],
  )

  return <TurnContext.Provider value={value}>{children}</TurnContext.Provider>
}
