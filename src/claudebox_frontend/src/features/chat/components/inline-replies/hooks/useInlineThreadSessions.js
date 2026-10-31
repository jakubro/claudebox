/** Per-float side-thread sessions, keyed by reply id: fork or resume, submit, subscribe, read. */

import { useCallback, useRef, useState } from 'react'
import { interruptSide, sendSideMessage } from '../../../../../api/chat'
import { forkSession, getSessionEvents, resumeSession } from '../../../../../api/sessions'
import { EventSubtype, EventType } from '../../../../../config/schema'
import { NORMAL_BATCH_INTERVAL } from '../../../../../config/timing'
import { useEvents } from '../../../../../context/EventsContext'
import { countExchanges, quoteBlock, threadOwnEvents } from '../threadEvents'

/** @param {string|null} containerId - The parent's container id; a side thread shares it. */
export default function useInlineThreadSessions(containerId) {
  const { subscribeSession } = useEvents()

  // replyId -> { sessionId, events, pending: [{content, at}], running, error }
  const [threads, setThreads] = useState(() => new Map())
  const cleanupsRef = useRef(new Map())
  // replyId -> events arrived since the last flush; one state update per batch, not per event.
  const bufferRef = useRef(new Map())
  const flushTimerRef = useRef(null)
  // replyId -> its first ask's fork, resolving to the side session's id
  const forksRef = useRef(new Map())

  const patch = useCallback((replyId, partial) => {
    setThreads(prev => {
      const next = new Map(prev)
      next.set(replyId, { ...(next.get(replyId) || {}), ...partial })

      return next
    })
  }, [])

  // Also drops events still buffered for the reply, so a reload right after cannot replay them twice.
  const detach = useCallback(replyId => {
    cleanupsRef.current.get(replyId)?.()
    cleanupsRef.current.delete(replyId)
    bufferRef.current.delete(replyId)
  }, [])

  // Folds every buffered event into its thread. An echoed question retires the oldest pending
  // one; a result or a logged error ends the answer, which renders in its own turn.
  const flush = useCallback(() => {
    clearTimeout(flushTimerRef.current)
    flushTimerRef.current = null

    if (bufferRef.current.size === 0) {
      return
    }

    const batches = [...bufferRef.current].map(([replyId, events]) => ({
      replyId,
      events,
      echoes: countExchanges(events, []),
      ending: events.find(_endsAnswer),
    }))
    bufferRef.current = new Map()

    setThreads(prev => {
      const next = new Map(prev)

      for (const { replyId, events, echoes, ending } of batches) {
        const entry = next.get(replyId) || {}
        const ended = ending
          ? { running: false, error: _endingError(ending) }
          : { running: entry.running, error: entry.error }

        next.set(replyId, {
          ...entry,
          ...ended,
          events: [...(entry.events || []), ...events],
          pending: (entry.pending || []).slice(echoes),
        })
      }

      return next
    })

    for (const { replyId, ending } of batches) {
      if (ending) {
        detach(replyId)
      }
    }
  }, [detach])

  // Reads the LATEST state (functional form) - two rapid submits for the same reply must each keep
  // their own pending question. Buffered events flush first, so `at` counts everything arrived.
  const appendQuestion = useCallback(
    (replyId, question) => {
      flush()
      setThreads(prev => {
        const entry = prev.get(replyId) || {}
        const events = entry.events || []
        const pending = [...(entry.pending || []), { content: question, at: events.length }]
        const next = new Map(prev)
        next.set(replyId, { ...entry, events, pending, running: true, error: null })

        return next
      })
    },
    [flush],
  )

  const handleEvent = useCallback(
    (replyId, raw) => {
      let event

      try {
        event = JSON.parse(raw.data)
      } catch {
        return
      }

      event.timestamp = Date.now()
      bufferRef.current.set(replyId, [...(bufferRef.current.get(replyId) || []), event])

      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flush, NORMAL_BATCH_INTERVAL)
      }
    },
    [flush],
  )

  const attach = useCallback(
    (replyId, sessionId) => {
      detach(replyId)
      // Always no-replay: submit() sends the prompt after this is wired, so nothing has been
      // persisted yet to replay; load()'s re-attach already read the log via the events route.
      const unsub = subscribeSession(sessionId, containerId, e => handleEvent(replyId, e), {
        replay: false,
        onError: () => {
          patch(replyId, { running: false, error: 'Lost the connection to this thread' })
          detach(replyId)
        },
      })
      cleanupsRef.current.set(replyId, unsub)
    },
    [subscribeSession, containerId, handleEvent, detach, patch],
  )

  /** Fork the parent into a shared-container side thread (first ask, sent beneath its quote) or
   * resume it (any later ask, even one made while that fork is on its way), then send it. */
  const submit = useCallback(
    async (reply, parentSessionId, text) => {
      const typed = text?.trim()

      if (!typed) {
        return null
      }

      const forking = reply.threadSessionId ? null : forksRef.current.get(reply.id)
      const fork =
        reply.threadSessionId || forking
          ? null
          : forkSession(parentSessionId, null, { share_container: true }).then(
              forked => forked.session_id,
            )
      if (fork) {
        forksRef.current.set(reply.id, fork)
      }

      const prompt = fork ? `${quoteBlock(reply.quote)}\n\n${typed}` : typed
      appendQuestion(reply.id, prompt)

      try {
        let sessionId

        if (fork) {
          sessionId = await fork
          patch(reply.id, { sessionId })
        } else {
          sessionId = reply.threadSessionId ?? (await forking)
          await resumeSession(sessionId)
        }

        attach(reply.id, sessionId)
        await sendSideMessage(sessionId, prompt, containerId)

        return sessionId
      } catch (_err) {
        forksRef.current.delete(reply.id)
        patch(reply.id, { running: false, error: 'Failed to send' })
        detach(reply.id)

        return null
      }
    },
    [attach, detach, patch, appendQuestion, containerId],
  )

  /** Mount/reload re-attach: read the persisted log, keep the thread's own events, and subscribe
   * live only if the read-only route reports the session still running. */
  const load = useCallback(
    async (replyId, sessionId) => {
      try {
        const { events, running } = await getSessionEvents(sessionId)

        patch(replyId, { sessionId, events: threadOwnEvents(events), pending: [], running })

        if (running) {
          attach(replyId, sessionId)
        }
      } catch {
        patch(replyId, { sessionId, events: [], pending: [], running: false })
      }
    },
    [attach, patch],
  )

  const interruptThread = useCallback(
    async replyId => {
      const entry = threads.get(replyId)

      if (!entry?.sessionId) {
        return
      }

      try {
        await interruptSide(entry.sessionId)
      } finally {
        patch(replyId, { running: false })
        detach(replyId)
      }
    },
    [threads, patch, detach],
  )

  const releaseAll = useCallback(() => {
    for (const cleanup of cleanupsRef.current.values()) {
      cleanup()
    }

    cleanupsRef.current.clear()
    clearTimeout(flushTimerRef.current)
    flushTimerRef.current = null
    bufferRef.current = new Map()
  }, [])

  return { threads, submit, load, interruptThread, detach, releaseAll }
}

function _endsAnswer(event) {
  return (
    event.type === EventType.RESULT ||
    (event.type === EventType.SYSTEM && event.subtype === EventSubtype.ERROR)
  )
}

// A logged error already renders in its turn; only an empty one needs the float's own line.
function _endingError(event) {
  return event.type === EventType.SYSTEM && !event.content?.trim()
    ? 'The answer failed to arrive'
    : null
}
