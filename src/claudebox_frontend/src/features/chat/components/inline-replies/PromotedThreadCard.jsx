/** Read-only card for a rail-promoted quote's highlight, shown by the ancestor and the overlay. */

import { useEffect, useState } from 'react'
import { getSessionEvents } from '../../../../api/sessions'
import { buildThreadHistory } from './hooks/useInlineThreadSessions'

/**
 * Fetched once per mount: the session rendering this card has no live subscription to the
 * promoted thread, so the card is a snapshot as of the hover rather than a following view.
 * @param {object} props
 * @param {string} props.quote - The originally-quoted text.
 * @param {string} props.threadSessionId - The promoted thread's own session id.
 * @param {function} props.onFocus - (threadSessionId) => void, the card's own control.
 */
export default function PromotedThreadCard({ quote, threadSessionId, onFocus }) {
  const [history, setHistory] = useState(null)

  useEffect(() => {
    let cancelled = false
    setHistory(null)

    getSessionEvents(threadSessionId)
      .then(({ events }) => {
        if (!cancelled) {
          setHistory(buildThreadHistory(events))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistory([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [threadSessionId])

  const opening = history?.[0]

  return (
    <div className="inline-thread promoted-thread-card" data-testid="promoted-thread-card">
      <div className="inline-thread-quote">
        <span className="inline-thread-quote-text">{quote}</span>
      </div>
      <div className="inline-thread-history">
        <div className="inline-thread-turn">
          <div className="inline-thread-question">{opening ? opening.question : '...'}</div>
          <div className="inline-thread-answer">{opening?.answer}</div>
        </div>
      </div>
      <button
        type="button"
        className="promoted-thread-card-focus"
        onClick={() => onFocus(threadSessionId)}
        data-testid="promoted-thread-focus">
        Focus this group
      </button>
    </div>
  )
}
