/** Manage pending messages with SSE reconciliation. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MIN_PENDING_DISPLAY_MS } from '../../../config/timing'
import { isHumanEvent } from '../../../utils/eventPredicates'
import { getDeliveredContents, isDelivered } from '../utils/pendingReconciliation'

/** Track pending messages and reconcile with SSE delivery. */
export default function usePendingMessages(events, sessionId) {
  const [pendingMessages, setPendingMessages] = useState([])

  // Clear pending messages only on genuine session switches (both old and new are
  // non-null and different). During resume, sessionId transitions old -> null -> old;
  // clearing on null would wipe a message submitted before the resume flow started.
  const prevSessionIdRef = useRef(sessionId)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    prevSessionIdRef.current = sessionId
    if (prev && sessionId && prev !== sessionId) {
      setPendingMessages([])
    }
  }, [sessionId])

  // Filter pending messages that haven't been delivered via SSE yet
  // Also respect minimum display time to prevent flicker
  const showPendingMessages = useMemo(() => {
    if (pendingMessages.length === 0) {
      return []
    }

    const now = Date.now()
    const humanEvents = events.filter(isHumanEvent)

    return pendingMessages.filter(pm => {
      // Always show if under minimum display time
      if (now - pm.addedAt < MIN_PENDING_DISPLAY_MS) {
        return true
      }
      // Hide if delivered
      return !isDelivered(getDeliveredContents(humanEvents, pm.addedAt), pm.content)
    })
  }, [pendingMessages, events])

  // Clear pending messages when SSE delivers matching human messages
  useEffect(() => {
    if (pendingMessages.length === 0) {
      return
    }

    const humanEvents = events.filter(isHumanEvent)

    // Remove pending messages that have been delivered
    const remaining = pendingMessages.filter(
      pm => !isDelivered(getDeliveredContents(humanEvents, pm.addedAt), pm.content),
    )

    if (remaining.length !== pendingMessages.length) {
      setPendingMessages(remaining)
    }
  }, [events, pendingMessages])

  // Add a pending message with optional attachments, returns its ID for later removal
  const addPendingMessage = useCallback((content, attachments = null) => {
    const id = crypto.randomUUID()
    setPendingMessages(prev => [
      ...prev,
      { id, content, attachments: attachments?.length ? attachments : null, addedAt: Date.now() },
    ])
    return id
  }, [])

  // Remove a specific pending message by ID (for error handling)
  const removePendingMessage = useCallback(id => {
    setPendingMessages(prev => prev.filter(pm => pm.id !== id))
  }, [])

  return { showPendingMessages, addPendingMessage, removePendingMessage }
}
