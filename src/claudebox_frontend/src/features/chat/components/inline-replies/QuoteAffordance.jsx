/** Floating "quote" button that appears near a transcript text selection. */

import { MessageSquareQuote } from 'lucide-react'
import { createPortal } from 'react-dom'
import useSelectionQuote from './hooks/useSelectionQuote'

/**
 * Render a floating quote affordance at the end of the current transcript selection.
 * @param {object} props
 * @param {object} props.messagesRef - Ref to the `.chat-messages` scroll container.
 * @param {boolean} props.enabled - Whether the affordance is active (desktop, in-session).
 * @param {function} props.onQuote - Called with { text, turnId, from } when clicked.
 */
export default function QuoteAffordance({ messagesRef, enabled, onQuote }) {
  const { affordance, clear } = useSelectionQuote(messagesRef, enabled)

  if (!affordance) {
    return null
  }

  function handleQuote() {
    onQuote({
      text: affordance.text,
      turnId: affordance.turnId,
      from: affordance.from,
      prefix: affordance.prefix,
      suffix: affordance.suffix,
      offset: affordance.offset,
    })
    window.getSelection?.()?.removeAllRanges()
    clear()
  }

  // Positioned in viewport coords (position: fixed) at the selection's bottom-right.
  // onMouseDown preventDefault keeps the selection alive until onClick reads it.
  return createPortal(
    <button
      type="button"
      className="quote-affordance"
      style={{ left: `${affordance.left}px`, top: `${affordance.top}px` }}
      onMouseDown={e => e.preventDefault()}
      onClick={handleQuote}
      data-testid="quote-affordance"
      title="Quote and reply">
      <MessageSquareQuote size={14} />
    </button>,
    document.body,
  )
}
