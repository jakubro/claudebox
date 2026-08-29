/** Inline-replies buffer: unsent, editable, per-session-persisted replies with durable anchors. */

import { useCallback, useEffect, useRef } from 'react'
import { INLINE_REPLIES_STORAGE_PREFIX } from '../../../../../config/storage'
import useLocalStorage from '../../../../../hooks/useLocalStorage'

// Stable default - a fresh [] per render re-fires useLocalStorage's key/default effect and loops.
// See useDrafts' DEFAULT_DRAFTS for the same pattern.
const EMPTY_UNSENT = [] // audit-ignore: misplaced-constant

/**
 * Persists to localStorage per session (mirroring chat drafts) and carries each reply's anchor;
 * sent threads are re-hydrated from the transcript turns' inline replies, not here.
 * @param {string|null} sessionId - Scopes the localStorage key; null disables persistence.
 */
export default function useInlineReplies(sessionId) {
  const [unsent, setUnsent, flushUnsent] = useLocalStorage(
    sessionId ? `${INLINE_REPLIES_STORAGE_PREFIX}${sessionId}` : null,
    EMPTY_UNSENT,
  )

  // Live ref so a send can read the current buffer without a stale closure.
  const unsentRef = useRef(unsent)
  unsentRef.current = unsent

  const add = useCallback(
    ({ text, turnId, from, prefix, suffix, offset }) => {
      setUnsent(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          quote: text,
          from,
          turnId: turnId ?? null,
          prefix: prefix ?? '',
          suffix: suffix ?? '',
          offset: offset ?? 0,
          response: '',
          // Set once a reply is asked in its own float, which excludes it from every batch send;
          // null marks an ordinary composer reply.
          threadSessionId: null,
          // Set once a thread is promoted to its own session - freezes the float read-only and
          // carries the link to where the conversation continues. null until promoted.
          promotedSessionId: null,
          // Set once a thread is promoted onto the rail (same session, no new one) - the float
          // closes, the highlight stays and becomes the way back to the thread's own group.
          railPromoted: false,
        },
      ])
    },
    [setUnsent],
  )

  const editReply = useCallback(
    (id, response) => {
      setUnsent(prev => prev.map(r => (r.id === id ? { ...r, response } : r)))
    },
    [setUnsent],
  )

  const remove = useCallback(
    id => {
      setUnsent(prev => prev.filter(r => r.id !== id))
    },
    [setUnsent],
  )

  // Link a reply to the side session that answers it in its own float - persists through the
  // same per-session record the unsent buffer already uses, so it survives a reload.
  const linkThreadSession = useCallback(
    (id, sessionId) => {
      setUnsent(prev => prev.map(r => (r.id === id ? { ...r, threadSessionId: sessionId } : r)))
    },
    [setUnsent],
  )

  // Link a thread to the session it was promoted into - persists the same way, so the freeze
  // survives a reload rather than reading back as an ordinary stopped (still-repliable) thread.
  const linkPromotedSession = useCallback(
    (id, promotedSessionId) => {
      setUnsent(prev => prev.map(r => (r.id === id ? { ...r, promotedSessionId } : r)))
    },
    [setUnsent],
  )

  // Mark a thread promoted onto the rail - persists the same way, so a reload finds it already
  // promoted rather than replaying the promotion (and its auto-stop cancellation) every time.
  const linkRailPromotion = useCallback(
    id => {
      setUnsent(prev => prev.map(r => (r.id === id ? { ...r, railPromoted: true } : r)))
    },
    [setUnsent],
  )

  // Drop blank and thread-linked replies, clear the unsent buffer, and return the anchored
  // payload; the anchors ride the injected event, and the backend strips them from the wire.
  const markSent = useCallback(() => {
    const nonBlank = unsentRef.current.filter(r => r.response.trim() && !r.threadSessionId)

    setUnsent(prev => prev.filter(r => r.threadSessionId))

    return nonBlank.map(r => ({
      quote: r.quote,
      from: r.from,
      response: r.response,
      turnId: r.turnId,
      prefix: r.prefix,
      suffix: r.suffix,
      offset: r.offset,
    }))
  }, [setUnsent])

  // Flush the unsent buffer to localStorage on tab close (mirrors useDrafts).
  useEffect(() => {
    window.addEventListener('beforeunload', flushUnsent)

    return () => window.removeEventListener('beforeunload', flushUnsent)
  }, [flushUnsent])

  return {
    unsent,
    add,
    editReply,
    remove,
    markSent,
    linkThreadSession,
    linkPromotedSession,
    linkRailPromotion,
    unsentRef,
  }
}
