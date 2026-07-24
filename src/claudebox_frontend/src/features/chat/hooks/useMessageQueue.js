/** Thin React wrapper for MessageQueueManager - state mirror, persistence, and lifecycle effects. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MESSAGE_QUEUE_STORAGE_PREFIX as STORAGE_PREFIX } from '../../../config/storage'
import MessageQueueManager from '../MessageQueueManager'

/**
 * Connect MessageQueueManager to React lifecycle with localStorage persistence.
 * @param {object} deps
 * @param {number} deps.resultCount - Response cycle completion counter from EventsContext.
 * @param {number} deps.compactionCount - Compaction completion counter from EventsContext.
 * @param {string|null} deps.interruptStatus - Current interrupt status.
 * @param {string|null} deps.errorMessage - Current error message.
 * @param {string|null} deps.sessionId - Active session ID.
 * @param {function} deps.sendFn - Callback to send a message (from useSendMessage).
 */
export default function useMessageQueue({
  resultCount,
  compactionCount,
  interruptStatus,
  errorMessage,
  sessionId,
  sendFn,
}) {
  const [queueItems, setQueueItems] = useState([])

  // Ref tracks current storage key - avoids stale closures in onChange
  const storageKeyRef = useRef(null)
  storageKeyRef.current = sessionId ? `${STORAGE_PREFIX}${sessionId}` : null

  // Stable manager instance with persistence in onChange
  const managerRef = useRef(null)
  if (!managerRef.current) {
    managerRef.current = new MessageQueueManager({
      onChange: items => {
        setQueueItems(items)
        const key = storageKeyRef.current
        if (key) {
          try {
            if (items.length === 0) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, JSON.stringify(items))
            }
          } catch {}
        }
      },
    })
  }
  const manager = managerRef.current

  // Drain on response cycle completion. resultCount increments inside the EventsContext
  // reducer (not in a React effect), so it catches isResponding true->false transitions
  // even when 50ms event batching collapses them into a single render.
  const prevResultCountRef = useRef(resultCount)
  useEffect(() => {
    if (resultCount > prevResultCountRef.current && manager.hasQueued()) {
      const item = manager.handleResponseCycleEnd()
      if (item) {
        sendFn(item.content, { attachments: item.attachments })
      }
    }
    prevResultCountRef.current = resultCount
  }, [resultCount, manager, sendFn])

  // Drain on compaction completion (compact_boundary event)
  const prevCompactionCountRef = useRef(compactionCount)
  useEffect(() => {
    if (compactionCount > prevCompactionCountRef.current && manager.hasQueued()) {
      const item = manager.handleResponseCycleEnd()
      if (item) {
        sendFn(item.content, { attachments: item.attachments })
      }
    }
    prevCompactionCountRef.current = compactionCount
  }, [compactionCount, manager, sendFn])

  // Pause on interrupt
  useEffect(() => {
    if (interruptStatus === 'stopping' || interruptStatus === 'stopped') {
      manager.handleInterrupt()
    }
  }, [interruptStatus, manager])

  // Pause on error
  useEffect(() => {
    if (errorMessage) {
      manager.handleError()
    }
  }, [errorMessage, manager])

  // Restore from localStorage on session change (or clear if nothing stored).
  // On fresh-session init (null->value), merge stored items with in-memory orphans
  // that were enqueued before sessionId was available for persistence.
  const prevSessionIdRef = useRef(sessionId)
  useEffect(() => {
    let items = []
    if (sessionId) {
      try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}${sessionId}`)
        if (stored) {
          items = JSON.parse(stored)
        }
      } catch {}
    }

    const wasNull = prevSessionIdRef.current === null
    if (wasNull && sessionId !== null && manager.items.length > 0) {
      manager.mergeRestore(items)
    } else {
      manager.restore(items)
    }
    prevSessionIdRef.current = sessionId
  }, [sessionId, manager])

  // Stable bound callbacks
  const enqueueMessage = useCallback(
    (content, attachments) => manager.enqueue(content, attachments),
    [manager],
  )
  const editQueuedItem = useCallback(id => manager.editItem(id), [manager])
  const cancelQueuedItem = useCallback(id => manager.cancelItem(id), [manager])
  const requeueItem = useCallback(id => manager.requeueItem(id), [manager])
  const sendNowItem = useCallback(
    id => {
      const item = manager.sendNowItem(id)
      if (item) {
        sendFn(item.content, { attachments: item.attachments })
      }
    },
    [manager, sendFn],
  )

  return {
    queueItems,
    enqueueMessage,
    editQueuedItem,
    cancelQueuedItem,
    requeueItem,
    sendNowItem,
  }
}
