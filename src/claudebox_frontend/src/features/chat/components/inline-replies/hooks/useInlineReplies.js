/** Inline-replies buffer: the unsent, editable, per-session-persisted replies (with durable anchors). */

import { useCallback, useEffect, useRef } from 'react'
import useLocalStorage from '../../../../../hooks/useLocalStorage'

// Stable default - a fresh [] each render would re-fire useLocalStorage's
// key/default effect and loop. See useDrafts' DEFAULT_DRAFTS.
const EMPTY_UNSENT = [] // audit-ignore: misplaced-constant

/**
 * Manage the inline-replies buffer for a session.
 *
 * The unsent buffer persists to localStorage per session (mirroring chat drafts) and carries each
 * reply's anchor; sent threads are re-hydrated from the transcript turns' inline replies, not here.
 * @param {string|null} sessionId - Scopes the localStorage key; null disables persistence.
 */
export default function useInlineReplies(sessionId) {
  const [unsent, setUnsent, flushUnsent] = useLocalStorage(
    sessionId ? `inline-replies:${sessionId}` : null,
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

  // Drop blank replies, clear the unsent buffer, and return the anchored payload for the send.
  // Anchor fields ride to the injected event (and reload); the backend strips them from the Claude wire.
  const markSent = useCallback(() => {
    const nonBlank = unsentRef.current.filter(r => r.response.trim())

    setUnsent([])

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

  return { unsent, add, editReply, remove, markSent, unsentRef }
}
