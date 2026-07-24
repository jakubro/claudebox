/** Track text selection within the transcript and expose a floating quote affordance. */

import { useCallback, useEffect, useState } from 'react'
import { captureAnchor, EXCLUDE_SELECTOR, INCLUDE_SELECTOR } from '../anchor'

/**
 * Watch selections inside `messagesRef` and surface a quote affordance near the selection end.
 *
 * Resolves from the selection anchor (clamp-to-anchor): a drag spanning two turns
 * attributes to the anchor turn rather than being dropped. Returns null while the
 * selection is collapsed, empty, or outside the transcript.
 * @param {object} messagesRef - Ref to the `.chat-messages` scroll container.
 * @param {boolean} enabled - Whether selection tracking is active (desktop, in-session).
 * @returns {{ affordance: object|null, clear: function }}
 */
export default function useSelectionQuote(messagesRef, enabled) {
  const [affordance, setAffordance] = useState(null)

  const clear = useCallback(() => setAffordance(null), [])

  useEffect(() => {
    if (!enabled) {
      setAffordance(null)

      return
    }

    const scroller = messagesRef.current

    function recompute() {
      const container = messagesRef.current
      const sel = window.getSelection?.()

      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setAffordance(null)

        return
      }

      const text = sel.toString().trim()

      if (!text) {
        setAffordance(null)

        return
      }

      const anchor = sel.anchorNode
      const el = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor

      if (!(el && container?.contains(el))) {
        setAffordance(null)

        return
      }

      const roleEl = el.closest('[data-testid="message-user"],[data-testid="message-assistant"]')

      if (!roleEl) {
        setAffordance(null)

        return
      }

      // Quotable = any selectable transcript text incl. tool output and thinking; media/chrome excluded.
      // Shared selectors with the anchor coordinate space keep selection and re-anchor in lockstep.
      if (!el.closest(INCLUDE_SELECTOR) || el.closest(EXCLUDE_SELECTOR)) {
        setAffordance(null)

        return
      }

      const range = sel.getRangeAt(0)
      const captured = captureAnchor(range, roleEl)

      if (!captured) {
        setAffordance(null)

        return
      }

      const turnEl = el.closest('[data-turn-id]')
      const from = roleEl.dataset.testid === 'message-user' ? 'user' : 'assistant'
      const rect = range.getBoundingClientRect()

      setAffordance({
        text,
        turnId: turnEl?.dataset.turnId ?? null,
        from,
        prefix: captured.prefix,
        suffix: captured.suffix,
        offset: captured.offset,
        left: rect.right,
        top: rect.bottom,
      })
    }

    document.addEventListener('selectionchange', recompute)
    scroller?.addEventListener('scroll', clear)
    window.addEventListener('resize', clear)

    return () => {
      document.removeEventListener('selectionchange', recompute)
      scroller?.removeEventListener('scroll', clear)
      window.removeEventListener('resize', clear)
    }
  }, [enabled, messagesRef, clear])

  return { affordance, clear }
}
