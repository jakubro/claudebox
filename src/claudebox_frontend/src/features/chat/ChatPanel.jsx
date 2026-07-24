/** Main chat panel with conversation turns, input, and minimap navigation. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { interrupt } from '../../api/chat'
import { getUiState, patchSessionUiState } from '../../api/uiState'
import ConfirmStopModal from '../../components/ConfirmStopModal.jsx'
import { useAppActions } from '../../context/AppActionsContext'
import { useBookmarksContext } from '../../context/BookmarksContext'
import { useDaemonStreamContext } from '../../context/DaemonStreamContext'
import { useEvents } from '../../context/EventsContext'
import { useInteraction } from '../../context/InteractionContext'
import { useSessionActions, useSessionData } from '../../context/SessionDataContext'
import { useSessionRouting } from '../../context/SessionRoutingContext'
import { useSessionsList } from '../../context/SessionsContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import useIsMobile from '../../hooks/useIsMobile'
import useNewSession from '../../hooks/useNewSession'
import { computeDuplicateAskUserIds } from '../../utils/eventProcessing'
import { scrollAndHighlight } from '../../utils/scroll'
import ChatInputArea from './components/ChatInputArea'
import ChatControlBar from './components/chat-control-bar'
import useComposerMaxHeight from './components/chat-input/hooks/useComposerMaxHeight'
import HistoricalTurnList from './components/HistoricalTurnList'
import { InlineThreadsOverlay, QuoteAffordance } from './components/inline-replies'
import useInlineReplies from './components/inline-replies/hooks/useInlineReplies'
import MiniMap from './components/minimap'
import QueuedMessageBubble from './components/QueuedMessageBubble'
import RewindModal from './components/RewindModal'
import SettingChangeDivider from './components/SettingChangeDivider'
import Turn from './components/turn'
import { TurnCollapseProvider } from './components/turn/TurnCollapseContext'
import WelcomeContent from './components/WelcomeContent'
import useChatController from './hooks/useChatController'
import useChatCreatingClear from './hooks/useChatCreatingClear'
import useChatRewindFork from './hooks/useChatRewindFork'
import useMessageJump from './hooks/useMessageJump'
import useNotifications from './hooks/useNotifications'
import useTurnHeights from './hooks/useTurnHeights'
import { findTopmostVisibleTurn } from './utils/findTopmostVisibleTurn'
import { getOverlayStatusText } from './utils/overlayStatus'
import { tryRefocusChatTextarea } from './utils/refocusChatInput'

/** Render main chat panel with conversation turns, input, and minimap navigation. */
export default function ChatPanel() {
  const {
    events,
    turns,
    turnResults,
    taskNotifications,
    todoDiffs,
    isConnected,
    isResponding,
    isResuming,
    isReplaying,
    replayTotal,
    replayProgress,
    containerId,
    isCompacting,
    isCreating,
    clearCreating,
    clearResume,
    startForking,
    clearForking,
  } = useEvents()

  const { progressMessage } = useDaemonStreamContext()

  const { isSubmitting, interruptStatus, isAwaitingResponse, setError } = useInteraction()

  const { sessionId, sessionName, workspace, notificationsEnabled } = useSessionData()
  const { reloadSession } = useSessionActions()
  const { activeSessionId, activeTurnId, activeMessageType, navigateToSession, replaceTurnInUrl } =
    useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { seedSession } = useSessionsList()
  const { isBookmarked, isTurnBookmarked, toggleBookmark } = useBookmarksContext()

  // Stable ref to events for ChatInput (avoids re-render from events subscription)
  const eventsRef = useRef(events)
  eventsRef.current = events

  // Stable ref to turns for the auto-collapse recompute effect - lets it read
  // the current turns without keying on the turns array (which changes every
  // streaming flush).
  const turnsRef = useRef(turns)
  turnsRef.current = turns

  const {
    jumpPrevRef,
    jumpNextRef,
    jumpTopRef,
    jumpBottomRef,
    chatScrollPositionRef,
    chatAutoScrollEnabledRef,
    autoCollapseEnabledRef,
    markUserIntentRef,
    markProgrammaticScrollRef,
    focusChatTab,
  } = useAppActions()

  // Rewind / fork orchestration - extracted to keep ChatPanel below the
  // cognitive-complexity gate. Wraps the 4 handlers and their associated
  // state (rewindTurnId, rewindMode, forkingTurnId, controlBarForking).
  const {
    rewindTurnId,
    rewindMode,
    forkingTurnId,
    controlBarForking,
    handleRewindRequest,
    handleForkRequest,
    handleRewindConfirm,
    closeRewindModal,
  } = useChatRewindFork({
    sessionId,
    workspaceId,
    isResponding,
    navigateToSession,
    focusChatTab,
    seedSession,
    setError,
    startForking,
    clearForking,
  })

  // Stabilize contextRefs identity so useChatController's init/dispose effect
  // runs exactly once per ChatPanel mount, not per render. Inner refs are
  // identity-stable (AppActionsContext useRef). Without this, every ChatPanel
  // render disposes and re-attaches ResizeObserver + wheel/touch/keydown
  // listeners - wasteful churn under streaming.
  const contextRefs = useMemo(
    () => ({ chatScrollPositionRef, chatAutoScrollEnabledRef }),
    [chatScrollPositionRef, chatAutoScrollEnabledRef],
  )

  // ChatController coordinates hooks with explicit ordering
  const {
    refs: { messagesRef, panelRef },
    scroll: {
      handleScroll,
      markProgrammaticScroll,
      markUserIntent,
      markReturnedToBottom,
      isAutoScrollEnabled: controllerAutoScrollEnabled,
    },
    pending: { showPendingMessages },
    queue: {
      queueItems,
      enqueueMessage,
      editQueuedItem,
      cancelQueuedItem,
      requeueItem,
      sendNowItem,
    },
    deferred: { deferredSend, deferSend },
    send,
  } = useChatController({
    events,
    contextRefs,
  })

  // Bridge deferred->pending visual continuity: hold the last deferred content
  // for one render cycle after deferredSend clears, until showPendingMessages
  // populates.
  const [deferredHold, setDeferredHold] = useState(null)
  const prevDeferredRef = useRef(deferredSend)
  useEffect(() => {
    if (prevDeferredRef.current && !deferredSend) {
      setDeferredHold(prevDeferredRef.current)
    }
    prevDeferredRef.current = deferredSend
  }, [deferredSend])
  useEffect(() => {
    if (deferredHold && showPendingMessages.length > 0) {
      setDeferredHold(null)
    }
  }, [deferredHold, showPendingMessages.length])

  // New-session workflow (welcome page deferred-send relies on this)
  const { executeNewSession } = useNewSession()

  // Message jump navigation (Alt+Up/Down, Alt+Home/End, control bar buttons).
  // Off-bottom jumps disengage autoscroll; at-bottom jumps re-engage it.
  const { jumpPrev, jumpNext, jumpTop, jumpBottom } = useMessageJump(
    messagesRef,
    markProgrammaticScroll,
    markUserIntent,
    markReturnedToBottom,
  )

  // Register jump callbacks so App-level shortcuts can reach them
  useEffect(() => {
    jumpPrevRef.current = jumpPrev
    jumpNextRef.current = jumpNext
    jumpTopRef.current = jumpTop
    jumpBottomRef.current = jumpBottom
    return () => {
      jumpPrevRef.current = null
      jumpNextRef.current = null
      jumpTopRef.current = null
      jumpBottomRef.current = null
    }
  }, [jumpPrev, jumpNext, jumpTop, jumpBottom, jumpPrevRef, jumpNextRef, jumpTopRef, jumpBottomRef])

  // Register scroll-intent callbacks so sibling panels (BookmarksPanel today,
  // TasksPanel and ChatPanel post-replay in follow-ups) can signal user intent
  // and bracket programmatic writes without coupling to ChatController.
  useEffect(() => {
    markUserIntentRef.current = markUserIntent
    markProgrammaticScrollRef.current = markProgrammaticScroll
    return () => {
      markUserIntentRef.current = null
      markProgrammaticScrollRef.current = null
    }
  }, [markUserIntent, markProgrammaticScroll, markUserIntentRef, markProgrammaticScrollRef])

  // Auto-clear creating state when SSE connects AFTER creation started, plus a
  // safety timeout if SSE never reconnects (e.g. container failure).
  useChatCreatingClear({
    isCreating,
    isConnected,
    deferredSend,
    deferredHold,
    showPendingMessagesLength: showPendingMessages.length,
    turnsLength: turns.length,
    clearCreating,
  })

  // Timeout: auto-clear resuming if replay_ended never arrives (e.g. SSE reconnect failure)
  useEffect(() => {
    if (!isResuming) {
      return
    }
    const timer = setTimeout(() => {
      clearResume()
    }, 30000)
    return () => clearTimeout(timer)
  }, [isResuming, clearResume])

  // Cross-session jump after replay: URL `/turns/<role>-<id>` segment carries
  // the target. ChatPanel reads activeTurnId+activeMessageType from routing
  // context, scrolls to the matching turn after replay completes, and
  // disengages autoscroll so subsequent SSE doesn't yank the view back.
  const wasReplayingRef = useRef(false)
  useEffect(() => {
    if (isReplaying) {
      wasReplayingRef.current = true
      return
    }
    if (!wasReplayingRef.current) {
      return
    }
    wasReplayingRef.current = false

    if (!activeTurnId) {
      return
    }

    // Defer to next frame so DOM has rendered
    requestAnimationFrame(() => {
      const turnEl = document.querySelector(`[data-turn-id="${activeTurnId}"]`)
      if (!turnEl) {
        return
      }
      let target =
        activeMessageType === 'user' ? turnEl.querySelector('[data-testid="message-user"]') : null
      if (!target) {
        target = turnEl.querySelector('[data-testid="message-assistant"]') || turnEl
      }
      const scrollContainer = messagesRef.current
      if (!scrollContainer) {
        return
      }
      chatAutoScrollEnabledRef.current = false
      scrollAndHighlight(scrollContainer, target)
    })
  }, [isReplaying, activeTurnId, activeMessageType, chatAutoScrollEnabledRef, messagesRef])

  // Autoscroll indicator state - driven by useChatController which forwards
  // controller.onAutoScrollChange transitions into reactive state.
  const isAutoScrollEnabled = controllerAutoScrollEnabled
  const [minimapPinned, setMinimapPinned] = useState(true)
  const isMobile = useIsMobile()
  // Mobile hides the minimap entirely; on desktop, MiniMap renders even when
  // unpinned because its internal auto-hide mode toggles a `visible` class on
  // the same element. The `minimap-pinned` className on the messages container
  // reserves layout space only when pinned (and only on desktop).
  const reserveMinimapSpace = minimapPinned && !isMobile

  // Restore the minimap toggle from persisted session UI state
  useEffect(() => {
    if (sessionId) {
      getUiState(sessionId)
        .then(data => {
          setMinimapPinned(data.session?.minimapPinned ?? true)
        })
        .catch(err => console.warn('ChatPanel: getUiState failed', err))
    }
  }, [sessionId])

  const handleToggleMinimap = useCallback(() => {
    setMinimapPinned(prev => {
      const next = !prev
      if (sessionId) {
        patchSessionUiState(sessionId, [{ op: 'set', path: 'minimapPinned', value: next }])
      }
      return next
    })
  }, [sessionId])

  // Inline replies: the unsent buffer (persisted per session, anchored). Sent threads
  // re-hydrate from the transcript turns' inline replies, so there is no side bar / toggle.
  const composerHandleRef = useRef(null)
  const {
    unsent: inlineRepliesUnsent,
    add: addInlineReply,
    editReply: editInlineReply,
    remove: removeInlineReply,
    markSent: markInlineRepliesSent,
    unsentRef: inlineRepliesUnsentRef,
  } = useInlineReplies(sessionId)

  // Unified dispatch: fold the buffered (non-blank) inline replies into a single
  // turn alongside the composer prompt + attachments. content=prompt (never the
  // serialized XML) keeps the optimistic pending turn reconcilable. No-op when
  // there is genuinely nothing to send.
  const sendWithInlineReplies = useCallback(
    (content, opts = {}) => {
      const nonBlank = inlineRepliesUnsentRef.current.filter(r => r.response.trim())
      const hasContent = typeof content === 'string' ? content.trim() : content
      if (!(hasContent || opts.attachments?.length) && nonBlank.length === 0) {
        return undefined
      }
      const wire = markInlineRepliesSent()
      return send(content, { ...opts, inlineReplies: wire.length > 0 ? wire : null })
    },
    [send, inlineRepliesUnsentRef, markInlineRepliesSent],
  )

  // Reply-only send gate: with no side bar, composer Enter is the trigger, so the
  // composer must know a batch is buffered to dispatch when its own field is empty.
  const hasBufferedReplies = useCallback(
    () => inlineRepliesUnsentRef.current.some(r => r.response.trim()),
    [inlineRepliesUnsentRef],
  )

  // Enter inside a reply box sends the whole batch (composer text + attachments + replies).
  const submitInlineReplyBatch = useCallback(() => {
    const payload = composerHandleRef.current?.extractOrEmpty?.() ?? {
      rawPrompt: '',
      currentAttachments: [],
    }
    sendWithInlineReplies(payload.rawPrompt, { attachments: payload.currentAttachments })
  }, [sendWithInlineReplies])

  // Affordance click: capture the quote; the highlight + docked box appear via the overlay.
  const handleQuote = useCallback(quote => addInlineReply(quote), [addInlineReply])

  // Composer max height, shared with the inline reply boxes' autoresize.
  const composerMaxHeight = useComposerMaxHeight(panelRef)

  // Sent inline-reply threads, sourced from the transcript turns (durable across reload) plus
  // the just-sent optimistic pending messages (so a fresh send docks immediately). Each reply
  // carries its own source-turn anchor, so the overlay docks it at its source block.
  const sentInlineThreads = useMemo(() => {
    const fromTurns = turns.flatMap(t =>
      (t.inlineReplies || []).map((r, i) => ({ ...r, id: `${t.turn_id}:reply:${i}` })),
    )
    const fromPending = showPendingMessages.flatMap((pm, pi) =>
      (pm.inlineReplies || []).map((r, i) => ({ ...r, id: `pending:${pi}:${i}` })),
    )
    return [...fromTurns, ...fromPending]
  }, [turns, showPendingMessages])

  // Auto-collapse: keep only the last turn expanded. The enabled flag mirrors
  // autoscroll's lifetime - stored in an app-level ref so it persists across
  // ChatPanel remounts (tab/board switch); reset to ON on session change below.
  const [autoCollapseEnabled, setAutoCollapseEnabled] = useState(
    () => autoCollapseEnabledRef.current,
  )
  const [collapsedTurnIds, setCollapsedTurnIds] = useState(() => new Set())
  // Turn ids the user hand-expanded while auto-collapse is on; the new-turn recompute
  // subtracts them so they stay open. In-memory; wiped on the enable edge and session change.
  const manuallyExpandedIdsRef = useRef(new Set())
  const lastTurnId = turns.length > 0 ? (turns[turns.length - 1]?.turn_id ?? null) : null

  const handleToggleAutoCollapse = useCallback(() => {
    setAutoCollapseEnabled(prev => {
      const next = !prev
      autoCollapseEnabledRef.current = next
      return next
    })
  }, [autoCollapseEnabledRef])

  const handleToggleTurnCollapse = useCallback(turnId => {
    setCollapsedTurnIds(prev => {
      const next = new Set(prev)
      if (next.has(turnId)) {
        // Expanding by hand: remember it so the new-turn recompute keeps it open.
        next.delete(turnId)
        manuallyExpandedIdsRef.current.add(turnId)
      } else {
        // Collapsing by hand: return the turn to auto control.
        next.add(turnId)
        manuallyExpandedIdsRef.current.delete(turnId)
      }
      return next
    })
  }, [])

  // Auto-collapse recompute (on enable and on each new turn): collapse every turn
  // except the last, minus the hand-expanded ones (sticky). The enable edge (off->on)
  // wipes that memory for a fresh collapse-all-but-last; the disable edge expands all.
  // Reads turnsRef so streaming flushes (lastTurnId unchanged) never re-run it.
  const prevAutoCollapseRef = useRef(autoCollapseEnabled)
  useEffect(() => {
    const wasEnabled = prevAutoCollapseRef.current
    prevAutoCollapseRef.current = autoCollapseEnabled
    if (autoCollapseEnabled) {
      const allTurnIds = turnsRef.current.map(t => t.turn_id).filter(Boolean)
      if (wasEnabled) {
        // New-turn edge: prune manual-expand memory to turns still present.
        const present = new Set(allTurnIds)
        for (const id of manuallyExpandedIdsRef.current) {
          if (!present.has(id)) {
            manuallyExpandedIdsRef.current.delete(id)
          }
        }
      } else {
        // Enable edge (off->on): fresh re-engage wipes manual-expand memory.
        manuallyExpandedIdsRef.current.clear()
      }
      const manual = manuallyExpandedIdsRef.current
      setCollapsedTurnIds(new Set(allTurnIds.filter(id => id !== lastTurnId && !manual.has(id))))
    } else if (wasEnabled) {
      setCollapsedTurnIds(new Set())
    }
  }, [autoCollapseEnabled, lastTurnId])

  // Reset auto-collapse to ON when the session changes (mirrors autoscroll's
  // session reset) - a new session always opens with only the last turn shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the reset trigger
  useEffect(() => {
    autoCollapseEnabledRef.current = true
    setAutoCollapseEnabled(true)
    manuallyExpandedIdsRef.current.clear()
  }, [sessionId, autoCollapseEnabledRef])

  // Refocus invariant: clicks on the empty .chat-messages container (background,
  // not on any turn / interactive child) restore focus to the chat textarea.
  // Pointer-tracking ref captures the down-position so we can distinguish
  // a clean click from a drag-select; dragging inside chat text must NEVER
  // refocus the textarea (would clear selection mid-gesture).
  const pointerDownPosRef = useRef(null)

  const handleMessagesPointerDown = useCallback(e => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMessagesClick = useCallback(
    e => tryRefocusChatTextarea(e, pointerDownPosRef.current),
    [],
  )

  // Throttled URL-segment sync - writes `/turns/<role>-<id>` while paused at a
  // turn, clears the segment when autoscroll re-engages at bottom. Suppressed
  // while replay is in flight so the URL doesn't churn during initial load.
  const turnUrlThrottleRef = useRef(null)
  const syncTurnSegmentToUrl = useCallback(() => {
    if (turnUrlThrottleRef.current) {
      return
    }
    turnUrlThrottleRef.current = setTimeout(() => {
      turnUrlThrottleRef.current = null
      const c = messagesRef.current
      if (!c) {
        return
      }
      const isAtBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 4
      if (isAtBottom && chatAutoScrollEnabledRef.current) {
        replaceTurnInUrl(null, null)
        return
      }
      const topmost = findTopmostVisibleTurn(c)
      if (topmost) {
        replaceTurnInUrl(topmost.turnId, topmost.role)
      }
    }, 250)
  }, [chatAutoScrollEnabledRef, messagesRef, replaceTurnInUrl])

  useEffect(() => {
    return () => {
      if (turnUrlThrottleRef.current) {
        clearTimeout(turnUrlThrottleRef.current)
      }
    }
  }, [])

  // Scroll handler - controller persists position and re-engages autoscroll
  // when the user manually scrolls back to the bottom; no React state writes
  // per scroll event (indicator state is updated only on transitions via the
  // onAutoScrollChange callback below, polled when the ref changes).
  const wrappedHandleScroll = useCallback(
    e => {
      handleScroll(e)
      if (!isReplaying) {
        syncTurnSegmentToUrl()
      }
    },
    [handleScroll, isReplaying, syncTurnSegmentToUrl],
  )

  // Track turn element heights for minimap proportionality
  const { turnHeights, userMessageHeights, getLogicalScrollHeight } = useTurnHeights(
    messagesRef,
    turns,
    isResponding,
    collapsedTurnIds,
  )

  // Desktop notifications and sound when response completes while tab is hidden
  useNotifications({
    isResponding,
    isReplaying,
    events,
    sessionName,
    workspace,
    notificationsEnabled,
  })

  // Cross-turn dedup: hide errored AskUserQuestion retries (same question headers)
  const duplicateAskUserIds = useMemo(() => computeDuplicateAskUserIds(turns), [turns])

  // Active/historical split: the last turn carries the live streaming
  // events and is rendered directly below; earlier turns are complete and render
  // through the memoized HistoricalTurnList so they don't reconcile on each
  // streaming flush. The hand-off is the slice boundary moving as turns grow -
  // keys (turn_id) are preserved, so the completing turn does not remount.
  const lastTurnIndex = turns.length - 1
  const activeTurn = turns.length > 0 ? turns[lastTurnIndex] : null
  const historicalTurns = turns.slice(0, -1)

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__renderCounts__ = window.__renderCounts__ || {}
    window.__renderCounts__.chatPanelBody = (window.__renderCounts__.chatPanelBody || 0) + 1
  }

  // Auto-scroll now handled by useChatController with explicit coordination

  // Show overlay during resume (before SSE connects), replay (event hydration), or creation
  const showReplayOverlay = isResuming || isReplaying || isCreating

  // Overlay mode for ChatInput: 'creating' allows typing, 'resuming' disables input
  const overlayMode = isCreating ? 'creating' : isResuming || isReplaying ? 'resuming' : null

  // Status text shown below the overlay progress bar
  const overlayStatusText = getOverlayStatusText({
    isCreating,
    progressMessage,
    isReplaying,
    replayProgress,
    replayTotal,
    isResuming,
  })

  // Interrupt handler
  const showInterrupt =
    isResponding ||
    showPendingMessages.length > 0 ||
    queueItems.length > 0 ||
    isSubmitting ||
    isAwaitingResponse

  // Form submit handler (for AskUserQuestion forms)
  const handleFormSubmit = useCallback(
    async content => {
      if (!content?.trim()) {
        return
      }
      await send(content)
    },
    [send],
  )

  // Edit a queued message - remove from queue, pass to ChatInput via state
  const [editingQueueItem, setEditingQueueItem] = useState(null)

  const handleEditQueued = useCallback(
    id => {
      const item = editQueuedItem(id)
      if (item) {
        setEditingQueueItem(item)
      }
    },
    [editQueuedItem],
  )

  const clearEditingQueueItem = useCallback(() => setEditingQueueItem(null), [])

  // Stabilize ChatInput's object-literal props so memo() shallow-compare passes
  // across per-token re-renders of ChatPanel. All inner refs are identity-stable.
  const inputRefs = useMemo(
    () => ({
      panel: panelRef,
      messages: messagesRef,
      autoScrollEnabled: chatAutoScrollEnabledRef,
      events: eventsRef,
      composerHandle: composerHandleRef,
    }),
    [panelRef, messagesRef, chatAutoScrollEnabledRef],
  )
  const queueEditProp = useMemo(
    () => ({ item: editingQueueItem, clear: clearEditingQueueItem }),
    [editingQueueItem, clearEditingQueueItem],
  )

  // Boolean derivative of events.length - flips once per session (false->true on
  // first event arrival) and stays stable thereafter, so it doesn't churn
  // ChatInput's memo() across per-token re-renders.
  const hasEvents = events.length > 0

  // Bundle ChatInputArea's flag-style props into a single object so the call
  // site stays under the props-per-component limit. Recomputed every render -
  // ChatInputArea itself isn't memoized.
  const inputState = {
    isConnected,
    canInterrupt: showInterrupt,
    isResponding,
    isAwaitingResponse,
    isSubmitting,
    overlayMode,
    hasEvents,
  }

  // Reload guard: confirm when Claude is responding
  const [pendingReload, setPendingReload] = useState(false)

  const handleReload = useCallback(() => {
    if (isResponding) {
      setPendingReload(true)
      return
    }
    reloadSession()
  }, [isResponding, reloadSession])

  const handleReloadConfirm = useCallback(async () => {
    setPendingReload(false)
    await interrupt()
    reloadSession()
  }, [reloadSession])

  const handleReloadCancel = useCallback(() => {
    setPendingReload(false)
  }, [])

  // Welcome state: no container, not creating, no active session.
  // Welcome and chat states share the same outer panel structure so the
  // composer (.chat-input wrapper) is rendered in identical DOM position
  // and the same ChatInput React instance persists across the welcome->chat
  // transition (required for the always-focused composer invariant).
  const isWelcome = !(containerId || isCreating || activeSessionId)

  // Welcome bridge: routes the first submitted message into deferSend, then
  // kicks off session creation. useChatController auto-sends the deferred
  // message once isCreating clears and sessionId arrives.
  const handleWelcomeDeferSend = useCallback(
    (content, attachments) => {
      const trimmed = typeof content === 'string' ? content.trim() : content
      if (!(trimmed || (attachments && attachments.length > 0))) {
        return
      }
      executeNewSession()
      deferSend(trimmed || '', attachments || [])
    },
    [executeNewSession, deferSend],
  )

  // ChatInputArea's action bundle - mirrors inputState above. onWelcomeDeferSend
  // is the welcome->active bridge; the rest forward unchanged.
  const inputActions = {
    send: sendWithInlineReplies,
    enqueueMessage,
    deferSend,
    onWelcomeDeferSend: handleWelcomeDeferSend,
    hasBufferedReplies,
  }

  return (
    <div className="chat-panel" ref={panelRef} data-testid="panel-chat">
      {!(isWelcome || showReplayOverlay) && (
        <ChatControlBar
          onReload={handleReload}
          onFork={handleForkRequest}
          forking={controlBarForking}
          messagesRef={messagesRef}
          autoScrollEnabledRef={chatAutoScrollEnabledRef}
          isAutoScrollEnabled={isAutoScrollEnabled}
          autoCollapseEnabled={autoCollapseEnabled}
          onToggleAutoCollapse={handleToggleAutoCollapse}
          onJumpPrev={jumpPrev}
          onJumpNext={jumpNext}
          minimapPinned={minimapPinned}
          onToggleMinimap={handleToggleMinimap}
        />
      )}
      <div className="chat-content-area">
        {isWelcome ? (
          <WelcomeContent />
        ) : (
          <>
            {showReplayOverlay && (
              <div className="chat-replay-overlay">
                <div className={`chat-replay-progress-bar${isCreating ? ' indeterminate' : ''}`}>
                  {!isCreating && (
                    <div
                      className="chat-replay-progress-fill"
                      style={{
                        width: `${replayTotal > 0 ? (replayProgress / replayTotal) * 100 : 0}%`,
                      }}
                    />
                  )}
                </div>
                {overlayStatusText && (
                  <p className="chat-replay-status-text">{overlayStatusText}</p>
                )}
              </div>
            )}
            <div
              className={`chat-messages${reserveMinimapSpace ? ' minimap-pinned' : ''}`}
              ref={messagesRef}
              onScroll={wrappedHandleScroll}
              onPointerDown={handleMessagesPointerDown}
              onClick={handleMessagesClick}
              tabIndex={-1}
              data-testid="chat-messages">
              {turns.length === 0 &&
              showPendingMessages.length === 0 &&
              queueItems.length === 0 &&
              !deferredSend &&
              !deferredHold &&
              !isCreating ? (
                <p className="chat-empty">Waiting for messages...</p>
              ) : (
                <TurnCollapseProvider
                  collapsedTurnIds={collapsedTurnIds}
                  onToggleTurnCollapse={handleToggleTurnCollapse}>
                  <HistoricalTurnList
                    turns={historicalTurns}
                    boundaryNextUserMessage={activeTurn?.userMessage ?? null}
                    todoDiffs={todoDiffs}
                    taskNotifications={taskNotifications}
                    turnResults={turnResults}
                    duplicateAskUserIds={duplicateAskUserIds}
                    hasPendingMessages={showPendingMessages.length > 0}
                    forkingTurnId={forkingTurnId}
                    onFormSubmit={handleFormSubmit}
                    onRewind={handleRewindRequest}
                    isBookmarked={isBookmarked}
                    onToggleBookmark={toggleBookmark}
                  />
                  {activeTurn && [
                    <Turn
                      key={`${activeTurn.turn_id || 'g'}-${lastTurnIndex}`}
                      userMessage={activeTurn.userMessage}
                      attachments={activeTurn.attachments}
                      inlineReplies={activeTurn.inlineReplies}
                      events={activeTurn.events}
                      turnId={activeTurn.turn_id}
                      todoDiffs={todoDiffs}
                      taskNotifications={taskNotifications}
                      resultStatus={activeTurn.turn_id ? turnResults[activeTurn.turn_id] : null}
                      interrupted={activeTurn.interrupted}
                      isActive={
                        (isResponding || isAwaitingResponse) &&
                        !interruptStatus &&
                        showPendingMessages.length === 0
                      }
                      showProgress={
                        (isResponding || isAwaitingResponse) &&
                        !interruptStatus &&
                        showPendingMessages.length === 0
                      }
                      isStopping={interruptStatus === 'stopping' || interruptStatus === 'stopped'}
                      hasNextUserMessage={false}
                      duplicateAskUserIds={duplicateAskUserIds}
                      onFormSubmit={handleFormSubmit}
                      onRewind={handleRewindRequest}
                      forking={forkingTurnId === activeTurn.turn_id}
                      isUserBookmarked={isBookmarked(activeTurn.turn_id, 'user')}
                      isAssistantBookmarked={isBookmarked(activeTurn.turn_id, 'assistant')}
                      onToggleBookmark={toggleBookmark}
                    />,
                    ...(activeTurn.settingChanges || []).map((event, ci) => (
                      <SettingChangeDivider key={`sc-${lastTurnIndex}-${ci}`} event={event} />
                    )),
                  ]}
                  {/* Pending Turns from prior session activity are hidden
                      during resume/replay so they don't bleed into the new
                      session's view (the chat-messages list is visible during
                      those states; without this gate, optimistic pending
                      messages from session A would appear in session B during
                      tab-switch). The deferred-message Turn is its own render
                      path and remains visible during boot. */}
                  <div className="chat-overlay-hoist">
                    {!(isResuming || isReplaying) &&
                      showPendingMessages.map((pm, i) => (
                        <Turn
                          key={`pending-${pm.id}`}
                          userMessage={pm.content}
                          attachments={pm.attachments}
                          inlineReplies={pm.inlineReplies}
                          events={[]}
                          pending={true}
                          hasNextUserMessage={true}
                          showProgress={i === showPendingMessages.length - 1 && !interruptStatus}
                          isStopping={
                            (interruptStatus === 'stopping' || interruptStatus === 'stopped') &&
                            i === showPendingMessages.length - 1
                          }
                          isCompacting={i === showPendingMessages.length - 1 && isCompacting}
                        />
                      ))}
                    {(deferredSend || deferredHold) && showPendingMessages.length === 0 && (
                      <Turn
                        key="deferred"
                        userMessage={(deferredSend || deferredHold).content}
                        attachments={(deferredSend || deferredHold).attachments}
                        events={[]}
                        pending={true}
                        hasNextUserMessage={true}
                        showProgress={true}
                        isCompacting={isCompacting}
                      />
                    )}
                    {queueItems.map(item => (
                      <QueuedMessageBubble
                        key={`queued-${item.id}`}
                        item={item}
                        onEdit={handleEditQueued}
                        onCancel={cancelQueuedItem}
                        onRequeue={requeueItem}
                        onSendNow={sendNowItem}
                      />
                    ))}
                  </div>
                </TurnCollapseProvider>
              )}
            </div>
            {!isMobile && (
              <InlineThreadsOverlay
                messagesRef={messagesRef}
                unsent={inlineRepliesUnsent}
                sentThreads={sentInlineThreads}
                resolveSignal={turns.length}
                maxHeight={composerMaxHeight}
                onEditReply={editInlineReply}
                onRemove={removeInlineReply}
                onSubmitBatch={submitInlineReplyBatch}
              />
            )}
            {!isMobile && (
              <MiniMap
                groups={turns}
                turnResults={turnResults}
                messagesRef={messagesRef}
                pendingCount={showPendingMessages.length}
                turnHeights={turnHeights}
                userMessageHeights={userMessageHeights}
                autoScrollEnabledRef={chatAutoScrollEnabledRef}
                persistent={minimapPinned}
                isStreaming={isResponding}
                isTurnBookmarked={isTurnBookmarked}
                getLogicalScrollHeight={getLogicalScrollHeight}
              />
            )}
            <QuoteAffordance
              messagesRef={messagesRef}
              enabled={!(isMobile || showReplayOverlay)}
              onQuote={handleQuote}
            />
          </>
        )}
      </div>
      <ChatInputArea
        isWelcome={isWelcome}
        state={inputState}
        actions={inputActions}
        refs={inputRefs}
        queueEdit={queueEditProp}
      />
      {!isWelcome && rewindTurnId && (
        <RewindModal
          mode={rewindMode}
          forkAll={rewindTurnId === '__all__'}
          forking={rewindTurnId === '__all__' ? controlBarForking : forkingTurnId != null}
          onConfirm={handleRewindConfirm}
          onCancel={closeRewindModal}
        />
      )}
      {!isWelcome && pendingReload && (
        <ConfirmStopModal
          variant="reload"
          onConfirm={handleReloadConfirm}
          onCancel={handleReloadCancel}
        />
      )}
    </div>
  )
}
