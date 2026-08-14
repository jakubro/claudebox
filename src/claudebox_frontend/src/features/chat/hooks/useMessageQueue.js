/** Thin React wrapper for MessageQueueManager - state mirror, persistence, and lifecycle effects. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MESSAGE_QUEUE_STORAGE_PREFIX as STORAGE_PREFIX } from '../../../config/storage'
import MessageQueueManager from '../MessageQueueManager'

/**
 * @param {object} deps
 * @param {number} deps.resultCount - Response cycle completion counter from EventsContext.
 * @param {number} deps.compactionCount - Compaction completion counter from EventsContext.
 * @param {boolean} deps.isLoading - True while a stored conversation is still materializing.
 * @param {string|null} deps.interruptStatus - Current interrupt status.
 * @param {string|null} deps.errorMessage - Current error message.
 * @param {string|null} deps.sessionId - Active session ID.
 * @param {function} deps.sendFn - Callback to send a message (from useSendMessage).
 */
export default function useMessageQueue({
  resultCount,
  compactionCount,
  isLoading,
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

  const drain = useCallback(() => {
    if (!manager.hasQueued()) {
      return
    }
    const item = manager.handleResponseCycleEnd()
    if (item) {
      sendFn(item.content, { attachments: item.attachments })
    }
  }, [manager, sendFn])

  // Drains when a LIVE response cycle ends. Both counters increment inside the EventsContext reducer
  // (not an effect), catching transitions that 50ms event batching would otherwise collapse.
  // Replaying a stored conversation also climbs both counters while history loads;
  // the loading flag separates a replayed completion from a live one.
  // Counters stay synced during the load, so the first live completion afterwards drains exactly one item.
  // The load-ending commit is skipped too: React batches the final replay slice with the replay-ended dispatch,
  // so that commit's counter jump is replay-driven, not a live completion to honour.
  const prevResultCountRef = useRef(resultCount)
  const prevCompactionCountRef = useRef(compactionCount)
  const wasLoadingRef = useRef(isLoading)
  useEffect(() => {
    const advanced =
      resultCount > prevResultCountRef.current || compactionCount > prevCompactionCountRef.current
    const wasLoading = wasLoadingRef.current

    prevResultCountRef.current = resultCount
    prevCompactionCountRef.current = compactionCount
    wasLoadingRef.current = isLoading

    if (isLoading || wasLoading) {
      return
    }

    if (advanced) {
      drain()
    }
  }, [resultCount, compactionCount, isLoading, drain])

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

  // Restores from localStorage on session change (or clears if nothing stored).
  // On fresh-session init (null->value), merges stored items with orphans queued before sessionId existed.
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
