/** Access turn-scoped context shared across Turn, ToolBlock, and ToolBlockExpandedContent. */

import { useContext } from 'react'
import { TurnContext } from '../TurnContext'

/**
 * @returns {{
 *   sessionId: string|null,
 *   hasNextUserMessage: boolean,
 *   nextUserMessageIsFormResponse: boolean,
 *   nextUserMessage: string,
 *   hasPendingMessages: boolean,
 *   todoDiffs: Map,
 *   taskNotifications: Object,
 *   onFormSubmit: Function|undefined,
 *   registerPendingForm: Function,
 *   turnStartTime: number,
 *   now: number,
 *   isActiveTurn: boolean
 * }}
 */
export function useTurn() {
  const context = useContext(TurnContext)
  if (!context) {
    throw new Error('useTurn must be used within a TurnProvider')
  }
  return context
}
