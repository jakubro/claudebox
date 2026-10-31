/** Manage pending messages with SSE reconciliation, each scoped to the session it was sent from. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MIN_PENDING_DISPLAY_MS } from '../../../config/timing'
import { isHumanEvent } from '../../../utils/eventPredicates'
import { getDeliveredContents, isDelivered } from '../utils/pendingReconciliation'

/**
 * Only the owner session's entries show, and only its own events reconcile them: `canReconcile`
 * is false while the events on screen may still belong to another session.
 * @param {Array} events - The attached session's events.
 * @param {string|null} ownerSessionId - The session on screen; entries record it when added.
 * @param {boolean} canReconcile - Whether `events` are the owner session's own.
 */
export default function usePendingMessages(events, ownerSessionId, canReconcile) {
  const [pendingMessages, setPendingMessages] = useState([])
  const ownerRef = useRef(ownerSessionId)
  ownerRef.current = ownerSessionId

  const ownPending = useMemo(
    () => pendingMessages.filter(pm => pm.sessionId === ownerSessionId),
    [pendingMessages, ownerSessionId],
  )

  // Filters out delivered messages, but respects minimum display time to prevent flicker.
  const showPendingMessages = useMemo(() => {
    if (ownPending.length === 0 || !canReconcile) {
      return ownPending
    }

    const now = Date.now()
    const humanEvents = events.filter(isHumanEvent)

    return ownPending.filter(pm => {
      // Always show if under minimum display time
      if (now - pm.addedAt < MIN_PENDING_DISPLAY_MS) {
        return true
      }
      // Hide if delivered
      return !isDelivered(getDeliveredContents(humanEvents, pm.addedAt), pm.content)
    })
  }, [ownPending, events, canReconcile])

  // Clear pending messages when SSE delivers matching human messages
  useEffect(() => {
    if (ownPending.length === 0 || !canReconcile) {
      return
    }

    const humanEvents = events.filter(isHumanEvent)
    const delivered = new Set(
      ownPending
        .filter(pm => isDelivered(getDeliveredContents(humanEvents, pm.addedAt), pm.content))
        .map(pm => pm.id),
    )

    if (delivered.size > 0) {
      setPendingMessages(prev => prev.filter(pm => !delivered.has(pm.id)))
    }
  }, [events, ownPending, canReconcile])

  // Add a pending message with optional attachments, inline replies, and a note; returns its ID
  const addPendingMessage = useCallback(
    (content, attachments = null, inlineReplies = null, note = null) => {
      const id = crypto.randomUUID()
      const sessionId = ownerRef.current
      setPendingMessages(prev => [
        ...prev,
        {
          id,
          sessionId,
          content,
          attachments: attachments?.length ? attachments : null,
          inlineReplies: inlineReplies?.length ? inlineReplies : null,
          note: note || null,
          addedAt: Date.now(),
        },
      ])
      return id
    },
    [],
  )

  // Remove a specific pending message by ID (for error handling)
  const removePendingMessage = useCallback(id => {
    setPendingMessages(prev => prev.filter(pm => pm.id !== id))
  }, [])

  return { showPendingMessages, addPendingMessage, removePendingMessage }
}
