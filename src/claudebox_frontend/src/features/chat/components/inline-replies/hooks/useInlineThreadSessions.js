/** Per-float side-thread sessions, keyed by reply id: fork or resume, submit, subscribe, read. */

import { useCallback, useRef, useState } from 'react'
import { interruptSide, sendSideMessage } from '../../../../../api/chat'
import { forkSession, getSessionEvents, resumeSession } from '../../../../../api/sessions'
import { useEvents } from '../../../../../context/EventsContext'
import { isForkDivider } from '../../../utils/turnFold'

/**
 * Rebuild a thread's question/answer history from its raw event log, segmented on each human
 * message and starting past the fork divider, so a reload draws only the thread's own exchanges.
 *
 * Each entry keeps its initiating turn id, so a re-attached reload routes arriving text to the
 * entry that asked for it even once a follow-up has added a newer one.
 * @param {Array} events
 * @returns {Array<{question: string, answer: string, turnId: string|null}>}
 */
export function buildThreadHistory(events) {
  let seam = -1

  for (let i = 0; i < events.length; i++) {
    if (isForkDivider(events[i])) {
      seam = i
    }
  }

  const own = seam === -1 ? events : events.slice(seam + 1)
  const history = []

  for (const e of own) {
    if (e.type === 'user' && e.is_human && e.content) {
      history.push({ question: e.content, answer: '', turnId: e.turn_id ?? null })
    } else if (e.type === 'assistant' && e.subtype === 'text' && e.content) {
      if (history.length === 0) {
        history.push({ question: '', answer: '', turnId: null })
      }
      history[history.length - 1].answer += e.content
    }
  }

  return history
}

/** @param {string|null} containerId - The parent's container id; a side thread shares it. */
export default function useInlineThreadSessions(containerId) {
  const { subscribeSession } = useEvents()

  // replyId -> { sessionId, history: [{question, answer}], running, error }
  const [threads, setThreads] = useState(() => new Map())
  const cleanupsRef = useRef(new Map())

  const patch = useCallback((replyId, partial) => {
    setThreads(prev => {
      const next = new Map(prev)
      next.set(replyId, { ...(next.get(replyId) || {}), ...partial })

      return next
    })
  }, [])

  const detach = useCallback(replyId => {
    cleanupsRef.current.get(replyId)?.()
    cleanupsRef.current.delete(replyId)
  }, [])

  // Reads history off the LATEST state (functional form), not a closure - two rapid submits
  // for the same reply must not have the second overwrite the first's own optimistic entry.
  const appendQuestion = useCallback((replyId, question) => {
    setThreads(prev => {
      const entry = prev.get(replyId)
      const history = [...(entry?.history || []), { question, answer: '', turnId: null }]
      const next = new Map(prev)
      next.set(replyId, { ...entry, running: true, error: null, history })

      return next
    })
  }, [])

  // The prompt is echoed back before the answer, carrying the turn id the runtime minted - bind
  // it to the most recently asked entry, since the frontend cannot know that id at send time.
  const bindTurnId = useCallback((replyId, turnId) => {
    setThreads(prev => {
      const entry = prev.get(replyId)

      if (!entry) {
        return prev
      }

      const history = entry.history.slice()

      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].turnId == null) {
          history[i] = { ...history[i], turnId }
          break
        }
      }

      const next = new Map(prev)
      next.set(replyId, { ...entry, history })

      return next
    })
  }, [])

  // Appends to the entry whose turn id matches, so two overlapping answers never cross; falls
  // back to the most recent entry when the id is absent or unmatched.
  const appendAnswer = useCallback((replyId, turnId, text) => {
    setThreads(prev => {
      const entry = prev.get(replyId)

      if (!entry || entry.history.length === 0) {
        return prev
      }

      const history = entry.history.slice()
      let idx = turnId ? history.findIndex(h => h.turnId === turnId) : -1

      if (idx === -1) {
        idx = history.length - 1
      }

      history[idx] = { ...history[idx], answer: `${history[idx].answer}${text}` }

      const next = new Map(prev)
      next.set(replyId, { ...entry, history })

      return next
    })
  }, [])

  const handleEvent = useCallback(
    (replyId, raw) => {
      let data

      try {
        data = JSON.parse(raw.data)
      } catch {
        return
      }

      if (data.type === 'user' && data.is_human && data.turn_id) {
        bindTurnId(replyId, data.turn_id)
      } else if (data.type === 'assistant' && data.subtype === 'text' && data.content) {
        appendAnswer(replyId, data.turn_id, data.content)
      } else if (data.type === 'result') {
        patch(replyId, { running: false })
        detach(replyId)
      } else if (data.type === 'system' && data.subtype === 'error') {
        patch(replyId, { running: false, error: data.content || 'The answer failed to arrive' })
        detach(replyId)
      }
    },
    [bindTurnId, appendAnswer, patch, detach],
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

  /** Fork the parent into a shared-container side thread (first ask) or resume an existing one
   * (a follow-up after it stopped), then send the given text as the next question. */
  const submit = useCallback(
    async (reply, parentSessionId, text) => {
      const prompt = text?.trim()

      if (!prompt) {
        return null
      }

      appendQuestion(reply.id, prompt)

      try {
        let sessionId = reply.threadSessionId

        if (sessionId) {
          await resumeSession(sessionId)
        } else {
          const forked = await forkSession(parentSessionId, null, { share_container: true })
          sessionId = forked.session_id
          patch(reply.id, { sessionId })
        }

        attach(reply.id, sessionId)
        await sendSideMessage(sessionId, prompt)

        return sessionId
      } catch (_err) {
        patch(reply.id, { running: false, error: 'Failed to send' })
        detach(reply.id)

        return null
      }
    },
    [attach, detach, patch, appendQuestion],
  )

  /** Mount/reload re-attach: read the persisted log, rebuild the history, and subscribe live only
   * if the read-only route reports the session still running. */
  const load = useCallback(
    async (replyId, sessionId) => {
      try {
        const { events, running } = await getSessionEvents(sessionId)
        const history = buildThreadHistory(events)

        patch(replyId, { sessionId, history, running })

        if (running) {
          attach(replyId, sessionId)
        }
      } catch {
        patch(replyId, { sessionId, history: [], running: false })
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
  }, [])

  return { threads, submit, load, interruptThread, detach, releaseAll }
}
