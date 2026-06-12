/** Chat input textarea with history, drafts, keyboard shortcuts, and attachment support. */

import { Square } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useInteraction } from '../../../../context/InteractionContext'
import { useSessionData } from '../../../../context/SessionDataContext'
import { useStash } from '../../../../context/StashContext'
import useInterruptHandler from '../../../../hooks/useInterruptHandler'
import useIsMobile from '../../../../hooks/useIsMobile'
import AttachmentPreview from './components/AttachmentPreview'
import CommandAutocomplete from './components/CommandAutocomplete'
import useAttachments from './hooks/useAttachments'
import useAutocomplete from './hooks/useAutocomplete'
import useAutoPair from './hooks/useAutoPair'
import useBlockCollapse from './hooks/useBlockCollapse'
import useChatKeyboard from './hooks/useChatKeyboard'
import useDrafts from './hooks/useDrafts'
import useInputHistory from './hooks/useInputHistory'
import useTextareaResize from './hooks/useTextareaResize'

/**
 * Render chat input textarea with submit, interrupt, stash, queue, and attachment support.
 * @param {Object} props
 * @param {boolean} props.isConnected - Whether WebSocket is connected
 * @param {boolean} props.canInterrupt - Whether interrupt is allowed
 * @param {Object} props.refs - Grouped refs from the chat panel.
 * @param {Object} props.refs.panel - Ref to chat panel container.
 * @param {Object} props.refs.messages - Ref to messages container.
 * @param {Object} props.refs.autoScrollEnabled - Ref tracking auto-scroll state.
 * @param {Object} props.refs.events - Ref to events array.
 * @param {boolean} props.hasEvents - Stable boolean signaling that the events
 *   array has at least one element; flips false->true on the first SSE event
 *   per session and stays stable thereafter (does not churn per token).
 * @param {Function} props.send - Shared send callback (from useSendMessage)
 * @param {Function} props.enqueueMessage - Queue a message for later sending
 * @param {Function} props.deferSend - Defer a message for auto-send when session creation completes.
 * @param {Object} props.queueEdit - Queue editing state.
 * @param {Object|null} props.queueEdit.item - Queue item being edited (load into textarea).
 * @param {Function} props.queueEdit.clear - Clear editing state after loading.
 * @param {'creating'|'resuming'|null} props.overlayMode - Overlay state: 'creating' allows typing, 'resuming' disables input.
 */
function ChatInput({
  isConnected,
  canInterrupt,
  isResponding,
  overlayMode,
  refs,
  hasEvents,
  send,
  enqueueMessage,
  deferSend,
  queueEdit,
}) {
  const {
    panel: panelRef,
    messages: messagesRef,
    autoScrollEnabled: autoScrollEnabledRef,
    events: eventsRef,
  } = refs || {}
  const { item: editingQueueItem, clear: clearEditingQueueItem } = queueEdit || {}

  // Overlay-derived state. The textarea itself is never disabled (always-
  // enabled invariant) - these flags gate the submit path only.
  const isSendBlocked = overlayMode === 'resuming'
  const isCreating = overlayMode === 'creating'

  // Refs
  const textareaRef = useRef(null)

  // Fallback refs if not provided (during transition or testing)
  const fallbackPanelRef = useRef(null)
  const fallbackMessagesRef = useRef(null)
  const fallbackAutoScrollRef = useRef(true)
  const effectivePanelRef = panelRef || fallbackPanelRef
  const effectiveMessagesRef = messagesRef || fallbackMessagesRef
  const effectiveAutoScrollRef = autoScrollEnabledRef || fallbackAutoScrollRef

  const isMobile = useIsMobile()

  // DEV-only render counter for measurement (tree-shaken in production builds).
  // Counts function-component invocations (renders). Test harness reads via
  // window.__cb_test_hooks?.chatInputRenderCount.
  const renderCountRef = useRef(0)
  renderCountRef.current += 1
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__cb_test_hooks ??= {}
      window.__cb_test_hooks.chatInputRenderCount = renderCountRef.current
    }
  })

  // Contexts (low/medium frequency - safe to consume directly)
  const { sessionId, commands } = useSessionData()
  const { stashPush, stashPop, pendingInsert, clearPendingInsert } = useStash()
  const {
    interruptStatus,
    startInterrupt,
    completeInterrupt,
    setError,
    isSubmitting,
    isAwaitingResponse,
  } = useInteraction()

  // Mobile send button morphs into a stop button while a response is in flight.
  // `isResponding` arrives as a prop from ChatPanel so we don't subscribe ChatInput
  // to EventsContext (avoids per-token re-renders on keystroke-hot path).
  const showStopButton = isMobile && (isResponding || isSubmitting || isAwaitingResponse)
  const stopButtonDisabled = !showStopButton || interruptStatus === 'stopping'
  const handleStopButtonInterrupt = useInterruptHandler({
    startInterrupt,
    completeInterrupt,
    setError,
    disabled: stopButtonDisabled,
  })

  // Local state
  const [sending, setSending] = useState(false)
  const [hasContent, setHasContent] = useState(false)

  // Hooks - owned by ChatInput
  const { resizeTextarea } = useTextareaResize(
    textareaRef,
    effectivePanelRef,
    effectiveMessagesRef,
    effectiveAutoScrollRef,
  )

  const { drafts, saveDrafts, userHasTypedRef } = useDrafts(sessionId, textareaRef, resizeTextarea)

  // Live drafts ref - single source of truth for InputHistoryManager. The React
  // `drafts` state lags behind keystrokes because persistDraftDirect bypasses
  // setValue (per-keystroke render budget). Sync the ref from React state ONLY
  // when React-state identity changes (session load, explicit saveDrafts) -
  // never blindly per render, which would clobber a fresher direct-write before
  // React has caught up. saveDraftsAndRef updates both in lockstep so
  // navigate-down push / submit / in-place edit stay coherent.
  const draftsRef = useRef(drafts)
  const lastReactDraftsRef = useRef(drafts)
  if (lastReactDraftsRef.current !== drafts) {
    lastReactDraftsRef.current = drafts
    draftsRef.current = drafts
  }

  const saveDraftsAndRef = useCallback(
    value => {
      draftsRef.current = value
      lastReactDraftsRef.current = value
      saveDrafts(value)
    },
    [saveDrafts],
  )

  const {
    addToHistory,
    navigateUp,
    navigateDown,
    resetIndex,
    getNavState,
    updateCurrentItem,
    prepareSubmit,
  } = useInputHistory(
    sessionId,
    eventsRef,
    hasEvents,
    draftsRef,
    saveDraftsAndRef,
    textareaRef,
    resizeTextarea,
  )

  const { wrapSelection } = useAutoPair(resizeTextarea)
  const { collapseLocal, collapseAll, expandLocal, expandAll, expandBeforeSubmit, resetCollapse } =
    useBlockCollapse(resizeTextarea)

  const autocomplete = useAutocomplete(textareaRef, commands)

  // Attachments hook
  const {
    attachments,
    setAttachments,
    dragOver,
    removeAttachment,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useAttachments({ setError, textareaRef })

  // Read and validate textarea content without clearing - used by handleSubmit for safe send
  const peekInput = useCallback(() => {
    if (isSendBlocked) {
      return null
    }
    if (textareaRef.current) {
      expandBeforeSubmit(textareaRef.current)
    }
    const rawPrompt = textareaRef.current?.value
    const hasText = rawPrompt?.trim()
    const hasAttachments = attachments.length > 0

    if (!(hasText || hasAttachments) || sending) {
      return null
    }

    return { rawPrompt: rawPrompt || '', currentAttachments: [...attachments] }
  }, [isSendBlocked, sending, attachments, expandBeforeSubmit])

  // Clear textarea and reset input state - called after successful send
  const commitInput = useCallback(
    rawPrompt => {
      if (rawPrompt?.trim()) {
        prepareSubmit(rawPrompt)
      }

      if (textareaRef.current) {
        textareaRef.current.value = ''
        resizeTextarea()
      }
      userHasTypedRef.current = false
      setHasContent(false)
      resetCollapse()
      setAttachments([])
    },
    [prepareSubmit, resizeTextarea, resetCollapse, userHasTypedRef, setAttachments],
  )

  // Extract textarea content, clear input, and return { rawPrompt, currentAttachments }
  const extractInput = useCallback(() => {
    const input = peekInput()
    if (!input) {
      return null
    }
    commitInput(input.rawPrompt)
    return input
  }, [peekInput, commitInput])

  // Keyboard + action handlers
  const { handleKeyDown, handleSubmit } = useChatKeyboard({
    textareaRef,
    peekInput,
    commitInput,
    extractInput,
    send,
    setSending,
    enqueueMessage,
    deferSend,
    isCreating,
    canInterrupt,
    interruptStatus,
    startInterrupt,
    completeInterrupt,
    setError,
    stashPush,
    stashPop,
    clearPendingInsert,
    saveDrafts,
    resizeTextarea,
    navigateUp,
    navigateDown,
    collapseLocal,
    collapseAll,
    expandLocal,
    expandAll,
    wrapSelection,
    isMobile,
  })

  // Composer focus invariant: textarea is always focused when the chat tab is
  // active. Mount-autofocus runs unconditionally on desktop; mobile skips it
  // to avoid an unsolicited OS keyboard popup. Subsequent state transitions
  // are handled by the sessionId/overlayMode effect below and the dockview-
  // reparent safety net (MutationObserver). The disabled gate on the textarea
  // is removed (always enabled) - submit-time guards live in `peekInput`.
  useEffect(() => {
    if (!isMobile && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isMobile])

  // Safety net: re-focus after dockview DOM moves. Dockview moves the React
  // portal's DOM subtree between containers (e.g., on replaceSessionTab or
  // navigateToSession), which removes and re-adds the same textarea element,
  // destroying focus without triggering React unmount. With the always-focused
  // composer invariant and ChatInput hoisted out of the dockview subtree, this
  // observer should not fire under normal operation - it remains as a last
  // line of defence for residual dockview reparent races. Keystrokes typed
  // during the debounce gap are buffered and replayed into the textarea.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    let debounce = null
    let bufferedKeys = []
    let bufferHandler = null

    function startBuffering() {
      bufferedKeys = []
      if (bufferHandler) {
        document.removeEventListener('keydown', bufferHandler, true)
      }
      bufferHandler = e => {
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          bufferedKeys.push(e.key)
          e.preventDefault()
        }
      }
      document.addEventListener('keydown', bufferHandler, true)
    }

    function stopBufferingAndReplay() {
      if (bufferHandler) {
        document.removeEventListener('keydown', bufferHandler, true)
        bufferHandler = null
      }
      if (!textarea.disabled && document.activeElement !== textarea) {
        textarea.focus()
      }
      if (bufferedKeys.length > 0) {
        textarea.value += bufferedKeys.join('')
        bufferedKeys = []
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node === textarea || (node.nodeType === 1 && node.contains(textarea))) {
            clearTimeout(debounce)
            startBuffering()
            debounce = setTimeout(stopBufferingAndReplay, 10)
          }
        }
      }
    })
    // Observe the nearest dockview content container for DOM moves
    const container = textarea.closest('.dv-content-container')
    if (container) {
      observer.observe(container, { childList: true, subtree: true })
    }
    return () => {
      observer.disconnect()
      clearTimeout(debounce)
      if (bufferHandler) {
        document.removeEventListener('keydown', bufferHandler, true)
      }
    }
  }, [])

  // Restore preserved input after container-gone recovery
  useEffect(() => {
    if (isConnected && textareaRef.current) {
      const preserved = sessionStorage.getItem('_cb_preserved_input')
      if (preserved) {
        sessionStorage.removeItem('_cb_preserved_input')
        textareaRef.current.value = preserved
        // Trigger resize by dispatching input event
        textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }, [isConnected])

  // Restore focus after session change or when the create overlay clears -
  // defer to second rAF so dockview's internal post-layout focus management
  // settles. Mobile skips refocus to avoid keyboard-popup hostility. The deps
  // are reactive triggers (the body itself does not read sessionId/overlayMode).
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId and overlayMode are intentional reactive triggers
  useEffect(() => {
    if (isMobile || !textareaRef.current) {
      return
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    })
  }, [sessionId, overlayMode, isMobile])

  // Handle pending insert from stash
  useEffect(() => {
    if (pendingInsert && textareaRef.current) {
      const currentInput = textareaRef.current.value
      if (currentInput.trim()) {
        addToHistory(currentInput)
      }
      textareaRef.current.value = pendingInsert
      saveDrafts({ current: pendingInsert, stack: [] })
      resetIndex()
      clearPendingInsert()
      resizeTextarea()
    }
  }, [pendingInsert, clearPendingInsert, addToHistory, saveDrafts, resetIndex, resizeTextarea])

  // Handle editing a queued message - load content into textarea
  useEffect(() => {
    if (editingQueueItem && textareaRef.current) {
      textareaRef.current.value = editingQueueItem.content
      if (editingQueueItem.attachments) {
        setAttachments(editingQueueItem.attachments)
      }
      resizeTextarea()
      clearEditingQueueItem()
    }
  }, [editingQueueItem, clearEditingQueueItem, resizeTextarea, setAttachments])

  // Per-keystroke localStorage write that bypasses useLocalStorage's setValue
  // (avoids a state-update render per char). The state copy in `drafts` only
  // matters at mount/session-change for restore; subsequent writes can persist
  // directly to localStorage without re-rendering ChatInput.
  const persistDraftDirect = useCallback(
    value => {
      // Sync ref first - useInputHistory's manager reads via draftsRef on each
      // navigation, so this must reflect the typed value before any Up/Down.
      draftsRef.current = value
      if (!sessionId) {
        return
      }
      const key = `draft:${sessionId}`
      const isEmpty = !value.current && (!value.stack || value.stack.length === 0)
      try {
        if (isEmpty) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, JSON.stringify(value))
        }
      } catch {
        // ignore quota errors
      }
    },
    [sessionId],
  )

  // Input handler. Reads drafts.stack via ref so callback identity stays stable
  // across keystrokes. Persists drafts directly to localStorage (no state
  // round-trip), keeping ChatInput render count at ~1 per keystroke
  // (target: < 1.5 per char).
  const handleInput = useCallback(
    e => {
      userHasTypedRef.current = true
      setHasContent(prev => {
        const next = !!e.target.value.trim()
        return prev === next ? prev : next
      })
      const navState = getNavState()
      if (navState.source) {
        updateCurrentItem(e.target.value)
      } else {
        persistDraftDirect({ current: e.target.value, stack: draftsRef.current.stack })
      }
    },
    [getNavState, updateCurrentItem, persistDraftDirect, userHasTypedRef],
  )

  // Wrap keydown to let autocomplete handle navigation first
  const handleKeyDownWithAutocomplete = useCallback(
    e => {
      if (autocomplete.handleKeyDown(e)) {
        return
      }
      handleKeyDown(e)
    },
    [autocomplete, handleKeyDown],
  )

  return (
    <div
      className={`chat-input-wrapper${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}>
      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
      {autocomplete.visible && (
        <CommandAutocomplete
          items={autocomplete.items}
          selectedIndex={autocomplete.selectedIndex}
          onSelect={autocomplete.select}
        />
      )}
      <div className={`chat-input-row${isMobile ? ' mobile' : ''}`}>
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          rows={1}
          placeholder=" "
          defaultValue=""
          onKeyDown={handleKeyDownWithAutocomplete}
          onInput={handleInput}
          onPaste={handlePaste}
        />
        {isMobile && (
          <button
            type="button"
            className={`mobile-send-btn${showStopButton ? ' mobile-send-btn-stop' : ''}`}
            onClick={showStopButton ? handleStopButtonInterrupt : handleSubmit}
            disabled={showStopButton ? stopButtonDisabled : !hasContent && attachments.length === 0}
            data-testid={showStopButton ? 'chat-input-stop-btn' : 'mobile-send-btn'}
            title={showStopButton ? 'Stop response' : 'Send message'}>
            {showStopButton ? (
              <Square size={16} />
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                role="img"
                aria-label="Send">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

export default memo(ChatInput)
