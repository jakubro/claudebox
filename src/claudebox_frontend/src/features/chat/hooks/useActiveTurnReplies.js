/** The newest turn's one-click replies, with an identity that changes only when the labels do. */

import { useMemo } from 'react'
import { activeTurnReplies } from '../utils/needsUserReplies'

/** Arguments as `activeTurnReplies`; a session refresh repeating the same labels keeps the array. */
export default function useActiveTurnReplies(sessionData, activeSessionId, events, hasPending) {
  const replies = activeTurnReplies(sessionData, activeSessionId, events, hasPending)
  const key = replies?.join('\n') ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the labels, not each refresh's array
  return useMemo(() => replies, [key])
}
