/** One inline-reply thread - the body of a floating composer: quoted-source attribution + reply field (or read-only when sent). */

// audit-ignore-file: excessive-props

import { Columns2, ExternalLink, Square, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useInteraction } from '../../../../context/InteractionContext'
import useInterruptHandler from '../../../../hooks/useInterruptHandler'
import { buildSessionHref } from '../../../../utils/navigation'
import BlockCollapseManager from '../chat-input/BlockCollapseManager'
import useTextEditingKeys from '../chat-input/hooks/useTextEditingKeys'
import PromotedThreadCard from './PromotedThreadCard'

/**
 * Render an inline-reply thread inside a floating composer.
 * @param {object} props
 * @param {object} props.reply - { id, quote, from, response, threadSessionId, promotedSessionId }.
 * @param {boolean} props.sent - Read-only when sent (batch send); editable when unsent.
 * @param {object} [props.thread] - Side-thread state { sessionId, history, running, error }, which
 *   takes over the render from `sent`/composer.
 * @param {number} props.maxHeight - Autoresize cap shared with the composer.
 * @param {boolean} [props.pinned] - Whether the float is pinned open (shows the close button).
 * @param {boolean} [props.autoFocus] - Focus the reply field on mount (a freshly-quoted reply).
 * @param {function} [props.onEdit] - Called (id, response) on edit (unsent only).
 * @param {function} [props.onRemove] - Called (id) on delete (unsent only).
 * @param {function} [props.onClose] - Called (id) when the close button is pressed.
 * @param {function} [props.onFocus] - Called (id) when the reply field gains focus (pins the float).
 * @param {function} [props.onSubmitThread] - (id, text) on Enter, asking in this float's thread.
 * @param {function} [props.onInterruptThread] - Called (id) to stop this thread's own answer.
 * @param {boolean} [props.canInterrupt] - Whether Ctrl+. is currently allowed (mirrors the composer's gate).
 * @param {function} [props.onPromote] - (id) to promote this thread into its own browser tab.
 * @param {function} [props.onPromoteToRail] - (id) to promote it onto the rail, same container.
 * @param {function} [props.onFocusRailPromoted] - (threadSessionId) => void, the control a
 *   rail-promoted reply's read-only card offers.
 * @param {string} [props.workspaceId] - Needed to build the promoted-session link once frozen.
 */
export default function InlineThread({
  reply,
  sent,
  thread,
  maxHeight,
  pinned,
  autoFocus,
  onEdit,
  onRemove,
  onClose,
  onFocus,
  onSubmitThread,
  onInterruptThread,
  canInterrupt,
  onPromote,
  onPromoteToRail,
  onFocusRailPromoted,
  workspaceId,
}) {
  const textareaRef = useRef(null)
  const historyRef = useRef(null)

  // InteractionContext is ambient and tracks the main session only, so thread mode swaps in the
  // thread's own running state and stop target.
  const { interruptStatus, startInterrupt, completeInterrupt, setError } = useInteraction()
  const [threadInterrupting, setThreadInterrupting] = useState(false)
  const handleMainInterrupt = useInterruptHandler({
    startInterrupt,
    completeInterrupt,
    setError,
    disabled: !canInterrupt || interruptStatus === 'stopping',
  })
  const handleThreadInterrupt = useInterruptHandler({
    startInterrupt: () => setThreadInterrupting(true),
    completeInterrupt: () => setThreadInterrupting(false),
    setError: () => setThreadInterrupting(false),
    disabled: !thread?.running || threadInterrupting,
    interruptFn: () => onInterruptThread(reply.id),
  })
  const handleInterrupt = thread ? handleThreadInterrupt : handleMainInterrupt

  // Local guard against a double-click double-promoting the same thread; onPromote's own
  // stop-then-fork sequence is the source of truth, this only debounces the button.
  const [promoting, setPromoting] = useState(false)
  const handlePromoteClick = useCallback(async () => {
    if (promoting) {
      return
    }
    setPromoting(true)
    try {
      await onPromote?.(reply.id)
    } finally {
      setPromoting(false)
    }
  }, [promoting, onPromote, reply.id])

  // Same debounce shape as the new-tab promote button, over the rail destination instead.
  const [promotingToRail, setPromotingToRail] = useState(false)
  const handlePromoteToRailClick = useCallback(async () => {
    if (promotingToRail) {
      return
    }
    setPromotingToRail(true)
    try {
      await onPromoteToRail?.(reply.id)
    } finally {
      setPromotingToRail(false)
    }
  }, [promotingToRail, onPromoteToRail, reply.id])

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

  // Opens on the most recent exchange, keyed on the exchange COUNT rather than thread.history:
  // streaming appends into the last entry without changing the length, so it never re-triggers.
  const historyLength = thread?.history?.length ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: historyLength is the re-run trigger
  useLayoutEffect(() => {
    const el = historyRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [historyLength])

  // Enter in a float asks (or follows up) in that float's own side thread and never sends the
  // batch; the batch is reached only from the main composer. Ctrl+Enter does the same.
  function handleKeyDown(e) {
    if (handleSharedKeyDown(e)) {
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Expand collapsed blocks first - a sent reply must never carry a placeholder. flushSync
      // commits onEdit's state update before the synchronous onSubmitThread call below reads it.
      const expanded = collapseManagerRef.current.expandBeforeSubmit(reply.response)
      if (expanded.value !== reply.response) {
        flushSync(() => onEdit(reply.id, expanded.value))
      }
      onSubmitThread?.(reply.id, expanded.value)
      onEdit(reply.id, '') // clear the composer - the sent text now lives in thread.history
    }
  }

  // Shared by the follow-up field and the plain composer - same element, different placeholder.
  // Never disabled: a follow-up can be typed while the thread's answer is still arriving.
  const replyTextarea = (
    <textarea
      ref={textareaRef}
      className="inline-thread-input"
      value={reply.response}
      onChange={e => onEdit(reply.id, e.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={() => onFocus?.(reply.id)}
      placeholder={thread ? 'Ask a follow-up...' : 'Reply...'}
      rows={1}
      data-testid="inline-thread-input"
    />
  )

  const promoted = Boolean(reply.promotedSessionId)
  const railPromoted = Boolean(reply.railPromoted)

  if (railPromoted) {
    // Read-only, no button row at all - the same card an ancestor's own overlay shows for this
    // quote, rendered here for the moment its source session is live and focused again.
    return (
      <PromotedThreadCard
        quote={reply.quote}
        threadSessionId={reply.threadSessionId}
        onFocus={onFocusRailPromoted}
      />
    )
  }

  return (
    <div className={`inline-thread${sent ? ' sent' : ''}`} data-testid="inline-thread">
      <div className="inline-thread-quote">
        <span className="inline-thread-from">{reply.from}</span>
        <span className="inline-thread-quote-text">{reply.quote}</span>
        {!(sent || thread) && onRemove && (
          <button
            type="button"
            className="inline-thread-icon-btn"
            onClick={() => onRemove(reply.id)}
            data-testid="inline-thread-delete"
            title="Delete reply">
            <Trash2 size={12} />
          </button>
        )}
        {thread && !promoted && onPromote && (
          <button
            type="button"
            className="inline-thread-icon-btn"
            onClick={handlePromoteClick}
            disabled={promoting}
            data-testid="inline-thread-promote"
            title="Promote to its own session">
            <ExternalLink size={12} />
          </button>
        )}
        {thread && !promoted && onPromoteToRail && (
          <button
            type="button"
            className="inline-thread-icon-btn"
            onClick={handlePromoteToRailClick}
            disabled={promotingToRail}
            data-testid="inline-thread-promote-rail"
            title="Promote to the rail">
            <Columns2 size={12} />
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
      {promoted ? (
        <>
          <div className="inline-thread-history" data-testid="inline-thread-history">
            {(thread?.history || []).map((turn, i) => (
              // Index is stable here: history only ever appends, never reorders or removes.
              <div className="inline-thread-turn" key={i}>
                <div className="inline-thread-question">{turn.question}</div>
                <div className="inline-thread-answer">{turn.answer}</div>
              </div>
            ))}
          </div>
          <div className="inline-thread-moved-link">
            this conversation moved -&gt;{' '}
            <a
              href={buildSessionHref(workspaceId, reply.promotedSessionId)}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="inline-thread-moved-link">
              open it
            </a>
          </div>
        </>
      ) : thread ? (
        <>
          <div
            className="inline-thread-history"
            data-testid="inline-thread-history"
            ref={historyRef}>
            {thread.history.map((turn, i) => (
              // Index is stable here: history only ever appends, never reorders or removes.
              <div className="inline-thread-turn" key={i}>
                <div className="inline-thread-question">{turn.question}</div>
                <div className="inline-thread-answer">
                  {turn.answer}
                  {thread.running && i === thread.history.length - 1 && (
                    <span className="inline-thread-working" data-testid="inline-thread-working" />
                  )}
                </div>
              </div>
            ))}
            {thread.error && <div className="inline-thread-error">{thread.error}</div>}
          </div>
          <div className="inline-thread-followup-row">
            {replyTextarea}
            {thread.running && (
              <button
                type="button"
                className="inline-thread-stop"
                onClick={handleInterrupt}
                disabled={threadInterrupting}
                data-testid="inline-thread-stop"
                title="Stop">
                <Square size={12} />
              </button>
            )}
          </div>
        </>
      ) : sent ? (
        <div className="inline-thread-response">{reply.response}</div>
      ) : (
        replyTextarea
      )}
    </div>
  )
}
