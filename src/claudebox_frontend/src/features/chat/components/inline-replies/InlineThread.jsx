/** One inline-reply thread - the body of a floating composer: quoted-source attribution + reply field (or read-only when sent). */

// audit-ignore-file: excessive-props

import { Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useInteraction } from '../../../../context/InteractionContext'
import useInterruptHandler from '../../../../hooks/useInterruptHandler'
import BlockCollapseManager from '../chat-input/BlockCollapseManager'
import useTextEditingKeys from '../chat-input/hooks/useTextEditingKeys'

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
 * @param {boolean} [props.canInterrupt] - Whether Ctrl+. is currently allowed (mirrors the composer's gate).
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
  canInterrupt,
}) {
  const textareaRef = useRef(null)

  // Mirrors ChatInput's interrupt handler; InteractionContext is ambient, no prop-threading beyond canInterrupt.
  const { interruptStatus, startInterrupt, completeInterrupt, setError } = useInteraction()
  const handleInterrupt = useInterruptHandler({
    startInterrupt,
    completeInterrupt,
    setError,
    disabled: !canInterrupt || interruptStatus === 'stopping',
  })

  // Own collapse state, but placeholder ids share BlockCollapseManager's module-level counter,
  // so ids never collide across boxes.
  const collapseManagerRef = useRef(null)
  if (!collapseManagerRef.current) {
    collapseManagerRef.current = new BlockCollapseManager()
  }

  // A programmatic edit writes the pending selection here; the layout effect below applies it after React commits.
  const pendingSelectionRef = useRef(null)

  const getState = useCallback(
    () => ({
      value: reply.response,
      selStart: textareaRef.current?.selectionStart ?? 0,
      selEnd: textareaRef.current?.selectionEnd ?? 0,
    }),
    [reply.response],
  )

  const applyResult = useCallback(
    result => {
      onEdit(reply.id, result.value)
      if (result.selStart !== undefined) {
        pendingSelectionRef.current = { selStart: result.selStart, selEnd: result.selEnd }
      }
    },
    [onEdit, reply.id],
  )

  // handleInterrupt already gates via `disabled` above, so useTextEditingKeys' own canInterrupt gate
  // stays at its permissive default.
  const { handleKeyDown: handleSharedKeyDown } = useTextEditingKeys({
    getState,
    applyResult,
    collapseManager: collapseManagerRef.current,
    onInterrupt: handleInterrupt,
  })

  // Layout effect must run before the selection-restore effect below, or its height/scrollTop reset
  // undoes setSelectionRange's scroll-into-view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reply.response drives the autoresize measure
  useLayoutEffect(() => {
    const ta = textareaRef.current

    if (!ta) {
      return
    }

    ta.style.height = 'auto'
    const next = Math.min(ta.scrollHeight, maxHeight)
    ta.style.height = `${next}px`
    ta.style.overflowY = next >= maxHeight ? 'auto' : 'hidden'
  }, [reply.response, maxHeight])

  // No dep array: runs every render, but the ref gate makes it a no-op except right after a key handler
  // sets a pending selection. Keying off reply.response would stomp the caret on unrelated re-renders.
  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current
    if (!pending) {
      return
    }
    pendingSelectionRef.current = null
    textareaRef.current?.setSelectionRange(pending.selStart, pending.selEnd)
  })

  // A freshly-quoted reply focuses immediately, without scrolling its just-positioned float into view.
  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus({ preventScroll: true })
    }
  }, [autoFocus])

  function handleKeyDown(e) {
    if (handleSharedKeyDown(e)) {
      return
    }

    // Enter sends the batch; Ctrl+Enter also works (existing behavior, not tightened here).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Expand collapsed blocks first - a sent reply must never carry a placeholder. flushSync
      // commits onEdit's state update before the synchronous onSubmit call below reads it.
      const expanded = collapseManagerRef.current.expandBeforeSubmit(reply.response)
      if (expanded.value !== reply.response) {
        flushSync(() => onEdit(reply.id, expanded.value))
      }
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
