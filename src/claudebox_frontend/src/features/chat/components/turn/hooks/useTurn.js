/** Access turn-scoped context shared across Turn, ToolBlock, and ToolBlockExpandedContent. */

import { useContext } from 'react'
import { TurnContext } from '../TurnContext'

/**
 * Access turn-scoped context. Must be used within a TurnProvider.
 * @returns {{ hasNextUserMessage: boolean, nextUserMessageIsFormResponse: boolean, nextUserMessage: string, hasPendingMessages: boolean, todoDiffs: Map, taskNotifications: Object, onFormSubmit: Function, turnStartTime: number, now: number, isActiveTurn: boolean }}
 */
export function useTurn() {
  const context = useContext(TurnContext)
  if (!context) {
    throw new Error('useTurn must be used within a TurnProvider')
  }
  return context
}
