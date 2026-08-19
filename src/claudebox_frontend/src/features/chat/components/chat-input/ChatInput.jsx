/** Chat input textarea with history, drafts, keyboard shortcuts, and attachment support. */

// audit-ignore-file: file-size, excessive-props

import { Send, Square } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { DRAFT_STORAGE_PREFIX } from '../../../../config/storage'
import { useInteraction } from '../../../../context/InteractionContext'
import { useSessionData } from '../../../../context/SessionDataContext'
import { useStash } from '../../../../context/StashContext'
import useInterruptHandler from '../../../../hooks/useInterruptHandler'
import useIsMobile from '../../../../hooks/useIsMobile'
import AttachmentPreview from './components/AttachmentPreview'
import CommandAutocomplete from './components/CommandAutocomplete'
import useAttachments from './hooks/useAttachments'
import useAutocomplete from './hooks/useAutocomplete'
import useBlockCollapse from './hooks/useBlockCollapse'
import useChatKeyboard from './hooks/useChatKeyboard'
import useDrafts from './hooks/useDrafts'
import useInputHistory from './hooks/useInputHistory'
import useTextareaResize from './hooks/useTextareaResize'

/**
 * @param {boolean} props.isConnected - Whether the WebSocket is connected.
 * @param {boolean} props.canInterrupt - Whether interrupt is allowed.
 * @param {object} props.refs - Grouped refs from the chat panel.
 * @param {object} props.refs.panel - Ref to the chat panel container.
 * @param {object} props.refs.messages - Ref to the messages container.
 * @param {object} props.refs.autoScrollEnabled - Ref tracking auto-scroll state.
 * @param {object} props.refs.events - Ref to the events array.
 * @param {object} props.refs.pendingForm - Ref to the active turn's live AskUserQuestion form, if any.
 * @param {boolean} props.hasEvents - Stable: flips false->true on the first SSE event, then holds (no per-token churn).
 * @param {Function} props.send - Shared send callback (from useSendMessage).
 * @param {Function} props.enqueueMessage - Queue a message for later sending.
 * @param {Function} props.deferSend - Defers a message to auto-send once session creation completes.
 * @param {object} props.queueEdit - Queue editing state.
 * @param {object|null} props.queueEdit.item - Queue item being edited (loaded into the textarea).
 * @param {Function} props.queueEdit.clear - Clears editing state after loading.
 * @param {'creating'|'resuming'|null} props.overlayMode - 'creating' allows typing; 'resuming' disables input.
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
  hasBufferedReplies,
  queueEdit,
}) {
  const {
    panel: panelRef,
    messages: messagesRef,
    autoScrollEnabled: autoScrollEnabledRef,
    events: eventsRef,
    composerHandle,
    pendingForm: pendingFormRef,
  } = refs || {}
  const { item: editingQueueItem, clear: clearEditingQueueItem } = queueEdit || {}

  // Overlay-derived state: textarea stays always-enabled; these flags only gate the submit path.
  const isSendBlocked = overlayMode === 'resuming'
  const isCreating = overlayMode === 'creating'

  const textareaRef = useRef(null)

  // Fallback refs if not provided (during transition or testing)
  const fallbackPanelRef = useRef(null)
  const fallbackMessagesRef = useRef(null)
  const fallbackAutoScrollRef = useRef(true)
  const effectivePanelRef = panelRef || fallbackPanelRef
  const effectiveMessagesRef = messagesRef || fallbackMessagesRef
  const effectiveAutoScrollRef = autoScrollEnabledRef || fallbackAutoScrollRef

  const isMobile = useIsMobile()

  // DEV-only render counter, tree-shaken in prod; test harness reads window.__cb_test_hooks?.chatInputRenderCount.
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

  // Mobile send button morphs into stop while responding; isResponding is a prop (not context) to
  // avoid per-token re-renders on the keystroke-hot path.
  const showStopButton = isMobile && (isResponding || isSubmitting || isAwaitingResponse)
  const stopButtonDisabled = !showStopButton || interruptStatus === 'stopping'
  const handleStopButtonInterrupt = useInterruptHandler({
    startInterrupt,
    completeInterrupt,
    setError,
    disabled: stopButtonDisabled,
  })

  const [sending, setSending] = useState(false)
  const [hasContent, setHasContent] = useState(false)

  const { resizeTextarea } = useTextareaResize(
    textareaRef,
    effectivePanelRef,
    effectiveMessagesRef,
    effectiveAutoScrollRef,
  )

  const { drafts, saveDrafts, userHasTypedRef } = useDrafts(sessionId, textareaRef, resizeTextarea)

  // draftsRef is InputHistoryManager's source of truth - React `drafts` lags since persistDraftDirect
  // bypasses setValue. Synced on identity change only, never per render (would clobber a fresher write).
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

  const { expandBeforeSubmit, resetCollapse, manager: collapseManager } = useBlockCollapse()

  const autocomplete = useAutocomplete(textareaRef, commands)

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

  // Imperative handle for an external submit (inline-replies bar Send): peek + clear, tolerating
  // an empty composer so a replies-only batch still sends.
  const extractOrEmpty = useCallback(() => {
    const input = peekInput()
    if (input) {
      commitInput(input.rawPrompt)
      return input
    }
    return { rawPrompt: '', currentAttachments: [] }
  }, [peekInput, commitInput])

  useEffect(() => {
    if (!composerHandle) {
      return
    }
    composerHandle.current = { extractOrEmpty }
    return () => {
      composerHandle.current = null
    }
  }, [composerHandle, extractOrEmpty])

  const { handleKeyDown, handleSubmit } = useChatKeyboard({
    textareaRef,
    peekInput,
    commitInput,
    extractInput,
    send,
    setSending,
    enqueueMessage,
    deferSend,
    hasBufferedReplies,
    pendingFormRef,
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
    navigateUp,
    navigateDown,
    collapseManager,
    isMobile,
  })

  // Composer focus invariant: stays focused while the chat tab is active. Desktop autofocuses on
  // mount (mobile skips it to avoid an OS keyboard popup); never disabled - guards live in `peekInput`.
  useEffect(() => {
    if (!isMobile && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isMobile])

  // Safety net: dockview moves the portal's DOM subtree between containers (e.g. replaceSessionTab,
  // navigateToSession), destroying focus without an unmount. Keystrokes during the gap are buffered and replayed.
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

  // Restore focus after a session change or the create-overlay clears - deferred to a second rAF so
  // dockview's post-layout focus settles. Mobile skips this; deps below are reactive triggers only.
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

  // Per-keystroke localStorage write bypassing useLocalStorage's setValue (avoids a render per
  // char); `drafts` state only matters at mount/session-change for restore.
  const persistDraftDirect = useCallback(
    value => {
      // Sync ref first - useInputHistory reads draftsRef on navigation and needs the typed value before Up/Down.
      draftsRef.current = value
      if (!sessionId) {
        return
      }
      const key = `${DRAFT_STORAGE_PREFIX}${sessionId}`
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

  // Reads drafts.stack via ref so callback identity stays stable across keystrokes, persisting
  // directly to localStorage (no state round-trip) to keep ChatInput near 1 render per keystroke.
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
        {/* Decorative compositor-driven border shimmer (pure CSS, GPU-rotated); non-interactive, behind the textarea. */}
        <div className="textarea-border-overlay" aria-hidden="true" />
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
            {showStopButton ? <Square size={16} /> : <Send size={16} />}
          </button>
        )}
      </div>
    </div>
  )
}

export default memo(ChatInput)
