/** Read-only card for a rail-promoted quote's highlight, shown by the ancestor and the overlay. */

import { useEffect, useState } from 'react'
import { getSessionEvents } from '../../../../api/sessions'
import ThreadExchanges from './ThreadExchanges'
import { openingExchange } from './threadEvents'

/**
 * Fetched once per mount: the session rendering this card has no live subscription to the
 * promoted thread, so the card is a snapshot as of the hover rather than a following view.
 * @param {object} props
 * @param {string} props.quote - The originally-quoted text.
 * @param {string} props.threadSessionId - The promoted thread's own session id.
 * @param {function} props.onFocus - (threadSessionId) => void, the card's own control.
 */
export default function PromotedThreadCard({ quote, threadSessionId, onFocus }) {
  const [events, setEvents] = useState(null)

  useEffect(() => {
    let cancelled = false
    setEvents(null)

    getSessionEvents(threadSessionId)
      .then(({ events: fetched }) => {
        if (!cancelled) {
          setEvents(openingExchange(fetched))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [threadSessionId])

  return (
    <div className="inline-thread promoted-thread-card" data-testid="promoted-thread-card">
      <div className="inline-thread-quote">
        <span className="inline-thread-quote-text">{quote}</span>
      </div>
      <div className="inline-thread-history">
        {events?.length ? (
          <ThreadExchanges
            events={events}
            running={false}
            sessionId={threadSessionId}
            quote={quote}
          />
        ) : (
          <div className="inline-thread-turn">...</div>
        )}
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
