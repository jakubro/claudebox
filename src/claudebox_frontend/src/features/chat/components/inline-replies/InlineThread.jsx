/** One inline-reply thread - the body of a floating composer: quoted-source attribution + reply field (or read-only when sent). */

import { Trash2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

/**
 * Render an inline-reply thread inside a floating composer.
 * @param {object} props
 * @param {object} props.reply - The reply { id, quote, from, response }.
 * @param {boolean} props.sent - Read-only when sent; editable when unsent.
 * @param {number} props.maxHeight - Autoresize cap shared with the composer.
 * @param {boolean} [props.pinned] - Whether the float is pinned open (shows the close button).
 * @param {boolean} [props.autoFocus] - Focus the reply field on mount (a freshly-quoted reply).
 * @param {function} [props.onEdit] - Called (id, response) on edit (unsent only).
 * @param {function} [props.onRemove] - Called (id) on delete (unsent only).
 * @param {function} [props.onClose] - Called (id) when the close button is pressed.
 * @param {function} [props.onFocus] - Called (id) when the reply field gains focus (pins the float).
 * @param {function} [props.onSubmit] - Called on Enter to send the whole batch (unsent only).
 */
export default function InlineThread({
  reply,
  sent,
  maxHeight,
  pinned,
  autoFocus,
  onEdit,
  onRemove,
  onClose,
  onFocus,
  onSubmit,
}) {
  const textareaRef = useRef(null)

  // Controlled autoresize: grow with content up to the shared composer cap, then scroll internally.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reply.response drives the autoresize measure
  useEffect(() => {
    const ta = textareaRef.current

    if (!ta) {
      return
    }

    ta.style.height = 'auto'
    const next = Math.min(ta.scrollHeight, maxHeight)
    ta.style.height = `${next}px`
    ta.style.overflowY = next >= maxHeight ? 'auto' : 'hidden'
  }, [reply.response, maxHeight])

  // A freshly-quoted reply focuses immediately, without scrolling its just-positioned float into view.
  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus({ preventScroll: true })
    }
  }, [autoFocus])

  function handleKeyDown(e) {
    // Enter sends the batch; Shift+Enter inserts a newline (default textarea behavior).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit?.()
    }
  }

  return (
    <div className={`inline-thread${sent ? ' sent' : ''}`} data-testid="inline-thread">
      <div className="inline-thread-quote">
        <span className="inline-thread-from">{reply.from}</span>
        <span className="inline-thread-quote-text">{reply.quote}</span>
        {!sent && onRemove && (
          <button
            type="button"
            className="inline-thread-icon-btn"
            onClick={() => onRemove(reply.id)}
            data-testid="inline-thread-delete"
            title="Delete reply">
            <Trash2 size={12} />
          </button>
        )}
        {pinned && onClose && (
          <button
            type="button"
            className="inline-thread-icon-btn"
            onClick={() => onClose(reply.id)}
            data-testid="inline-thread-close"
            title="Close">
            <X size={12} />
          </button>
        )}
      </div>
      {sent ? (
        <div className="inline-thread-response">{reply.response}</div>
      ) : (
        <textarea
          ref={textareaRef}
          className="inline-thread-input"
          value={reply.response}
          onChange={e => onEdit(reply.id, e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => onFocus?.(reply.id)}
          placeholder="Reply..."
          rows={1}
          data-testid="inline-thread-input"
        />
      )}
    </div>
  )
}
