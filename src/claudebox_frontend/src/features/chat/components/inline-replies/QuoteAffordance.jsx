/** Floating "quote" button that appears near a transcript text selection. */

import { MessageSquareQuote } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import useSelectionQuote from './hooks/useSelectionQuote'

/**
 * @param {object} props
 * @param {object} props.messagesRef - Ref to the `.chat-messages` scroll container.
 * @param {boolean} props.enabled - Whether the affordance is active (desktop, in-session).
 * @param {function} props.onQuote - Called with { text, turnId, from } when clicked or on Tab.
 * @param {object} props.showingRef - Ref kept true while the button shows, for other Tab claimants.
 */
export default function QuoteAffordance({ messagesRef, enabled, onQuote, showingRef }) {
  const { affordance, clear } = useSelectionQuote(messagesRef, enabled)

  useEffect(() => {
    showingRef.current = Boolean(affordance)
    return () => {
      showingRef.current = false
    }
  }, [showingRef, affordance])

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

  // Tab is claimed only while the button shows, and never from a text field, where it indents.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleQuote reads this render's affordance
  useEffect(() => {
    if (!affordance) {
      return undefined
    }
    const onKeyDown = e => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
        return
      }
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) {
        return
      }
      e.preventDefault()
      handleQuote()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [affordance])

  if (!affordance) {
    return null
  }

  // Fixed-position at the selection's bottom-right; onMouseDown's preventDefault keeps the
  // selection alive until onClick reads it.
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
