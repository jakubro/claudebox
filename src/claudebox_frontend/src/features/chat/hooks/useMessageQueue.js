/** Thin React wrapper for MessageQueueManager - state mirror, persistence, and lifecycle effects. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MESSAGE_QUEUE_STORAGE_PREFIX as STORAGE_PREFIX } from '../../../config/storage'
import { updateStoredList } from '../../../utils/storedList'
import MessageQueueManager, { failedMessageItem, withSendFailure } from '../MessageQueueManager'

/**
 * @param {object} deps
 * @param {number} deps.resultCount - Response cycle completion counter from EventsContext.
 * @param {number} deps.compactionCount - Compaction completion counter from EventsContext.
 * @param {boolean} deps.isLoading - True while a stored conversation is still materializing.
 * @param {string|null} deps.interruptStatus - Current interrupt status.
 * @param {string|null} deps.sessionId - Active session ID.
 * @param {string|null} deps.containerId - Container serving it; queued items are sent to the pair.
 * @param {function} deps.sendFn - Callback to send a message (from useSendMessage); the hook returns
 *   it wrapped as `send`, so a failed send pauses the queue of the session it was sent in.
 */
export default function useMessageQueue({
  resultCount,
  compactionCount,
  isLoading,
  interruptStatus,
  sessionId,
  containerId,
  sendFn,
}) {
  const [queueItems, setQueueItems] = useState([])

  // Ref tracks current storage key - avoids stale closures in onChange
  const storageKeyRef = useRef(null)
  storageKeyRef.current = sessionId ? `${STORAGE_PREFIX}${sessionId}` : null
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const containerIdRef = useRef(containerId)
  containerIdRef.current = containerId

  // Stable manager instance with persistence in onChange
  const managerRef = useRef(null)
  if (!managerRef.current) {
    managerRef.current = new MessageQueueManager({
      onChange: items => {
        setQueueItems(items)
        const key = storageKeyRef.current
        const owned = items.filter(i => !i.owner)
        if (key) {
          try {
            if (owned.length === 0) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, JSON.stringify(owned))
            }
          } catch {}
        }
      },
    })
  }
  const manager = managerRef.current

  // A failed send pauses the queue of the session it was sent in - the one on screen in memory,
  // one left since in its saved queue - returning its item, if any, to the front.
  const settleSendFailure = useCallback(
    (owner, failedItem) => {
      if (!owner || owner === sessionIdRef.current) {
        manager.handleSendFailure(failedItem)
      } else {
        updateStoredList(`${STORAGE_PREFIX}${owner}`, items => withSendFailure(items, failedItem))
      }
    },
    [manager],
  )

  const sendItem = useCallback(
    async (owner, item) => {
      const sent = await sendFn(item.content, {
        attachments: item.attachments,
        target: { sessionId: owner, containerId: containerIdRef.current },
      })
      if (!sent) {
        settleSendFailure(owner, item)
      }
    },
    [sendFn, settleSendFailure],
  )

  const send = useCallback(
    async (content, options) => {
      const owner = sessionIdRef.current
      const sent = await sendFn(content, options)
      if (!sent) {
        settleSendFailure(owner, null)
      }

      return sent
    },
    [sendFn, settleSendFailure],
  )

  const drain = useCallback(async () => {
    if (!manager.hasQueued()) {
      return
    }
    const owner = sessionIdRef.current
    const item = manager.handleResponseCycleEnd()
    if (item) {
      await sendItem(owner, item)
    }
  }, [manager, sendItem])

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

  // Restores the attached session's stored queue on session change, or clears it if none is stored.
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
    manager.restore(items)
  }, [sessionId, manager])

  // Stable bound callbacks
  const enqueueMessage = useCallback(
    (content, attachments, owner) => manager.enqueue(content, attachments, { owner }),
    [manager],
  )
  const takeCreation = useCallback(seq => manager.takeCreation(seq), [manager])
  const adoptCreation = useCallback(seq => manager.adoptCreation(seq), [manager])
  const returnFailedMessage = useCallback(
    (owner, content, attachments) =>
      settleSendFailure(owner, failedMessageItem(content, attachments)),
    [settleSendFailure],
  )
  const editQueuedItem = useCallback(id => manager.editItem(id), [manager])
  const cancelQueuedItem = useCallback(id => manager.cancelItem(id), [manager])
  const requeueItem = useCallback(id => manager.requeueItem(id), [manager])
  const sendNowItem = useCallback(
    async id => {
      const owner = sessionIdRef.current
      const item = manager.sendNowItem(id)
      if (item) {
        await sendItem(owner, item)
      }
    },
    [manager, sendItem],
  )

  return {
    queueItems,
    send,
    enqueueMessage,
    returnFailedMessage,
    editQueuedItem,
    cancelQueuedItem,
    requeueItem,
    sendNowItem,
    takeCreation,
    adoptCreation,
  }
}
