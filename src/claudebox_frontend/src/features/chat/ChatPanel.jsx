/** Main chat panel with conversation turns, input, and minimap navigation. */

// audit-ignore-file: file-size

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { interrupt } from '../../api/chat'
import { getUiState, patchSessionUiState } from '../../api/uiState'
import ConfirmStopModal from '../../components/ConfirmStopModal.jsx'
import ErrorBoundary from '../../components/ErrorBoundary.jsx'
import { SCROLL_SETTLE_MAX_FRAMES } from '../../config/timing'
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
import { withMountedTurn } from '../../utils/mountTurn'
import ChatInputArea from './components/ChatInputArea'
import ChatSplitDivider from './components/ChatSplitDivider'
import ChatControlBar from './components/chat-control-bar'
import useComposerMaxHeight from './components/chat-input/hooks/useComposerMaxHeight'
import HistoricalTurnList from './components/HistoricalTurnList'
import { InlineThreadsOverlay, QuoteAffordance } from './components/inline-replies'
import useInlineReplies from './components/inline-replies/hooks/useInlineReplies'
import MiniMap from './components/minimap'
import QueuedMessageBubble from './components/QueuedMessageBubble'
import RewindModal from './components/RewindModal'
import SettingChangeDivider from './components/SettingChangeDivider'
import TerminalColumn from './components/terminal'
import Turn from './components/turn'
import { HideShellCallsContext } from './components/turn/HideShellCallsContext'
import { TurnCollapseProvider } from './components/turn/TurnCollapseContext'
import WelcomeContent from './components/WelcomeContent'
import useChatController from './hooks/useChatController'
import useChatCreatingClear from './hooks/useChatCreatingClear'
import useChatRewindFork from './hooks/useChatRewindFork'
import useMessageJump from './hooks/useMessageJump'
import useNotifications from './hooks/useNotifications'
import { useTerminalSplitLayout } from './hooks/useTerminalSplitLayout'
import useTurnHeights from './hooks/useTurnHeights'
import { useTurnJump } from './hooks/useTurnJump'
import { findTopmostVisibleTurn } from './utils/findTopmostVisibleTurn'
import { getOverlayStatusText } from './utils/overlayStatus'
import { tryRefocusChatTextarea } from './utils/refocusChatInput'
import { deriveTerminalEntries } from './utils/terminalEvents'

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

  // turnsRef lets the auto-collapse effect read current turns without turns as a dep (it churns every flush).
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
    scrollToTurnRef,
    expandTurnRef,
    focusChatTab,
  } = useAppActions()

  // Extracted to keep ChatPanel below the cognitive-complexity gate; wraps the rewind/fork state and handlers.
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

  // Stabilizes contextRefs identity so useChatController's init/dispose effect runs once per mount.
  // Without this, every render disposes and re-attaches ResizeObserver + input listeners.
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
      scrollToBottom,
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

  // Bridges deferred->pending continuity: holds the last deferred content until showPendingMessages populates.
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

  // Filled by HistoricalTurnList so every jump can reach a windowed-out turn.
  const turnVirtualizerRef = useRef(null)

  // Off-bottom jumps disengage autoscroll; at-bottom jumps re-engage it.
  const { jumpPrev, jumpNext, jumpTop, jumpBottom } = useMessageJump(
    messagesRef,
    markProgrammaticScroll,
    markUserIntent,
    markReturnedToBottom,
    turnVirtualizerRef,
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

  // Lets sibling panels (BookmarksPanel) signal user intent, bracketing writes without coupling to ChatController.
  useEffect(() => {
    markUserIntentRef.current = markUserIntent
    markProgrammaticScrollRef.current = markProgrammaticScroll
    return () => {
      markUserIntentRef.current = null
      markProgrammaticScrollRef.current = null
    }
  }, [markUserIntent, markProgrammaticScroll, markUserIntentRef, markProgrammaticScrollRef])

  // Sibling panels can't query a windowed-out turn in the DOM, so they hand the id here to mount it first.
  useEffect(() => {
    scrollToTurnRef.current = (turnId, onResolved) =>
      withMountedTurn({
        turnId,
        turns: turnsRef.current.slice(0, -1),
        virtualizer: turnVirtualizerRef.current,
        onResolved,
      })
    return () => {
      scrollToTurnRef.current = null
    }
  }, [scrollToTurnRef])

  // Auto-clears creating state once SSE connects, plus a timeout if it never reconnects (container failure).
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

  // Kept out of ChatPanel for the cognitive-complexity gate; runs the cross-session replay jump.
  const { handleTerminalEntryClick } = useTurnJump({
    turnsRef,
    turnVirtualizerRef,
    messagesRef,
    chatAutoScrollEnabledRef,
    isReplaying,
    activeTurnId,
    activeMessageType,
  })

  // Driven by useChatController, which forwards controller.onAutoScrollChange transitions into reactive state.
  const isAutoScrollEnabled = controllerAutoScrollEnabled
  const [minimapPinned, setMinimapPinned] = useState(true)
  const isMobile = useIsMobile()
  // On desktop, MiniMap still renders when unpinned (auto-hide toggles a `visible` class on it).
  // The `minimap-pinned` className reserves layout space only when pinned and on desktop.
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

  // Preference + ratio, hydrated per session; a width-driven collapse leaves the preference alone.
  const {
    contentAreaRef,
    terminalSplit,
    showTerminalSplit,
    toggleTerminalSplit,
    setTerminalSplitRatio,
  } = useTerminalSplitLayout(sessionId, isMobile)
  const terminalEntries = useMemo(() => deriveTerminalEntries(events), [events])

  // The unsent buffer persists per session; sent threads re-hydrate from turns' inline replies, no side bar.
  const composerHandleRef = useRef(null)

  // {hasSelection, submit} for the active turn's live form; Enter in the composer submits it.
  // Only one turn awaits an answer, so ToolBlock's register/unregister is last-writer-wins.
  const pendingFormRef = useRef(null)
  const registerPendingForm = useCallback(entry => {
    pendingFormRef.current = entry
  }, [])
  const {
    unsent: inlineRepliesUnsent,
    add: addInlineReply,
    editReply: editInlineReply,
    remove: removeInlineReply,
    markSent: markInlineRepliesSent,
    unsentRef: inlineRepliesUnsentRef,
  } = useInlineReplies(sessionId)

  // Folds buffered inline replies into one turn with the composer prompt + attachments; no-op if empty.
  // content=prompt (never the serialized XML) keeps the optimistic pending turn reconcilable.
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

  // With no side bar, composer Enter is the trigger, so it must know a batch is buffered when its field is empty.
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

  // Sourced from transcript turns (durable) plus just-sent pending messages, so a fresh send docks immediately.
  // Each reply carries its own source-turn anchor, so the overlay docks it at its source block.
  const sentInlineThreads = useMemo(() => {
    const fromTurns = turns.flatMap(t =>
      (t.inlineReplies || []).map((r, i) => ({ ...r, id: `${t.turn_id}:reply:${i}` })),
    )
    const fromPending = showPendingMessages.flatMap((pm, pi) =>
      (pm.inlineReplies || []).map((r, i) => ({ ...r, id: `pending:${pi}:${i}` })),
    )
    return [...fromTurns, ...fromPending]
  }, [turns, showPendingMessages])

  // Mirrors autoscroll's lifetime - an app-level ref persists this across ChatPanel remounts (tab/board switch).
  // Reset to ON on session change (below).
  const [autoCollapseEnabled, setAutoCollapseEnabled] = useState(
    () => autoCollapseEnabledRef.current,
  )
  const [collapsedTurnIds, setCollapsedTurnIds] = useState(() => new Set())
  // Turn ids hand-expanded while auto-collapse is on; the new-turn recompute keeps them open.
  // Wiped on the enable edge and session change.
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

  // Sibling panels can't open a collapsed turn directly; delegating to the header toggle keeps
  // manuallyExpandedIdsRef in sync so the turn doesn't silently re-collapse.
  useEffect(() => {
    expandTurnRef.current = turnId => {
      if (turnId && collapsedTurnIds.has(turnId)) {
        handleToggleTurnCollapse(turnId)
      }
    }
    return () => {
      expandTurnRef.current = null
    }
  }, [expandTurnRef, collapsedTurnIds, handleToggleTurnCollapse])

  // Collapses every turn but the last, minus hand-expanded ones (sticky).
  // Reads turnsRef, not turns, so a streaming flush alone (lastTurnId unchanged) doesn't re-run it.
  const prevAutoCollapseRef = useRef(autoCollapseEnabled)
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns.length is a deliberate trigger (see below)
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
    // turns.length is a dep alongside lastTurnId: a replay slice can add turns without changing the last one.
    // Keying on lastTurnId alone leaves arrivals expanded, mis-sizing minimap segments (short-strip pricing).
  }, [autoCollapseEnabled, lastTurnId, turns.length])

  // Mirrors autoscroll's session reset - a new session opens with only the last turn shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the reset trigger
  useEffect(() => {
    autoCollapseEnabledRef.current = true
    setAutoCollapseEnabled(true)
    manuallyExpandedIdsRef.current.clear()
  }, [sessionId, autoCollapseEnabledRef])

  // Clicks on the empty .chat-messages background (not a turn/interactive child) restore focus to the textarea.
  // pointerDownPosRef tells a click from a drag-select; dragging must never refocus (would clear the selection).
  const pointerDownPosRef = useRef(null)

  const handleMessagesPointerDown = useCallback(e => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMessagesClick = useCallback(
    e => tryRefocusChatTextarea(e, pointerDownPosRef.current),
    [],
  )

  // Writes `/turns/<role>-<id>` while paused at a turn, clears it when autoscroll re-engages at bottom.
  // Suppressed during replay so the URL doesn't churn on initial load.
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

  // The controller persists position and re-engages autoscroll on manual scroll back to bottom.
  // No React state writes per scroll event; indicator state updates only on transitions via onAutoScrollChange.
  const wrappedHandleScroll = useCallback(
    e => {
      handleScroll(e)
      if (!isReplaying) {
        syncTurnSegmentToUrl()
      }
    },
    [handleScroll, isReplaying, syncTurnSegmentToUrl],
  )

  // Minimap proportionality is priced by the content predictor: a windowed-out turn has no element to measure.
  const { turnHeights, userMessageHeights, getLogicalScrollHeight } = useTurnHeights(
    messagesRef,
    turns,
    collapsedTurnIds,
    showTerminalSplit,
  )

  // Turns land with estimated heights; windowed rows swap in real heights over several frames, so
  // re-scroll every frame until scrollHeight stops growing, capped so an animation can't stall it.
  // Keyed on turns.length, not an isReplaying edge: React can fold a whole replay into one commit.
  // Skipped while replaying (refires later) and when the URL names a turn (races that deep link).
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns.length is a deliberate trigger (see below)
  useEffect(() => {
    if (isReplaying || activeTurnId) {
      return undefined
    }

    let id
    let lastHeight = -1
    let lastScrollTop = -1
    let framesLeft = SCROLL_SETTLE_MAX_FRAMES
    const settle = () => {
      const el = messagesRef.current
      if (!el) {
        return
      }
      // Our writes never shrink scrollTop, so a drop means something outside repositioned the view
      // (e.g. a direct scrollTop write bypassing markUserIntent); back off rather than fight it.
      if (lastScrollTop >= 0 && el.scrollTop < lastScrollTop) {
        return
      }

      scrollToBottom()
      framesLeft -= 1
      lastScrollTop = el.scrollTop
      const height = el.scrollHeight
      if (framesLeft > 0 && height !== lastHeight) {
        lastHeight = height
        id = requestAnimationFrame(settle)
      }
    }
    id = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(id)
  }, [turns.length, isReplaying, activeTurnId, scrollToBottom, messagesRef])

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

  // The last turn carries live events; earlier ones render via the memoized HistoricalTurnList (skips reconcile).
  // The hand-off is the slice boundary moving as turns grow - turn_id keys persist so it doesn't remount.
  const lastTurnIndex = turns.length - 1
  const activeTurn = turns.length > 0 ? turns[lastTurnIndex] : null
  const historicalTurns = turns.slice(0, -1)

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__renderCounts__ = window.__renderCounts__ || {}
    window.__renderCounts__.chatPanelBody = (window.__renderCounts__.chatPanelBody || 0) + 1
  }

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

  // extractOrEmpty tolerates an empty composer, so the no-note case needs no branch.
  // sendWithInlineReplies also folds in buffered inline replies and clears the composer.
  const handleFormSubmit = useCallback(
    async answer => {
      const payload = composerHandleRef.current?.extractOrEmpty?.() ?? {
        rawPrompt: '',
        currentAttachments: [],
      }
      await sendWithInlineReplies(answer, {
        attachments: payload.currentAttachments,
        note: payload.rawPrompt,
      })
    },
    [sendWithInlineReplies],
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

  // Stabilizes ChatInput's object-literal props so memo() shallow-compare passes across per-token re-renders.
  const inputRefs = useMemo(
    () => ({
      panel: panelRef,
      messages: messagesRef,
      autoScrollEnabled: chatAutoScrollEnabledRef,
      events: eventsRef,
      composerHandle: composerHandleRef,
      pendingForm: pendingFormRef,
    }),
    [panelRef, messagesRef, chatAutoScrollEnabledRef],
  )
  const queueEditProp = useMemo(
    () => ({ item: editingQueueItem, clear: clearEditingQueueItem }),
    [editingQueueItem, clearEditingQueueItem],
  )

  // Flips once per session (first event arrival) and stays stable, so it doesn't churn ChatInput's memo().
  const hasEvents = events.length > 0

  // Bundles ChatInputArea's flag props into one object to stay under the props-per-component limit.
  // Recomputed every render - ChatInputArea itself isn't memoized.
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

  // Welcome and chat share the outer panel structure, so one ChatInput instance persists across the transition.
  // Required for the always-focused composer invariant.
  const isWelcome = !(containerId || isCreating || activeSessionId)

  // Routes the first submitted message into deferSend, then kicks off session creation.
  // useChatController auto-sends it once isCreating clears and sessionId arrives.
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

  // Mirrors inputState above. onWelcomeDeferSend is the welcome->active bridge; the rest forward unchanged.
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
          terminalSplitEnabled={terminalSplit?.enabled ?? false}
          onToggleTerminalSplit={toggleTerminalSplit}
        />
      )}
      <div className="chat-content-area" ref={contentAreaRef}>
        <ErrorBoundary label="chat-transcript" resetKey={sessionId}>
          {isWelcome ? (
            <WelcomeContent />
          ) : (
            <>
              <div
                className="chat-transcript-column"
                style={
                  showTerminalSplit
                    ? {
                        flexGrow: 0,
                        flexShrink: 0,
                        flexBasis: `${(terminalSplit.ratio * 100).toFixed(4)}%`,
                      }
                    : undefined
                }>
                {showReplayOverlay && (
                  <div className="chat-replay-overlay">
                    <div
                      className={`chat-replay-progress-bar${isCreating ? ' indeterminate' : ''}`}>
                      {!isCreating && (
                        <div
                          className="chat-replay-progress-fill"
                          style={{
                            // Clamped: live events drain through this queue, outside replayTotal.
                            width: `${replayTotal > 0 ? Math.min(100, (replayProgress / replayTotal) * 100) : 0}%`,
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
                    <HideShellCallsContext.Provider value={showTerminalSplit}>
                      <TurnCollapseProvider
                        collapsedTurnIds={collapsedTurnIds}
                        onToggleTurnCollapse={handleToggleTurnCollapse}>
                        <HistoricalTurnList
                          messagesRef={messagesRef}
                          virtualizerRef={turnVirtualizerRef}
                          turns={historicalTurns}
                          boundaryNextUserMessage={activeTurn?.userMessage ?? null}
                          todoDiffs={todoDiffs}
                          taskNotifications={taskNotifications}
                          turnResults={turnResults}
                          duplicateAskUserIds={duplicateAskUserIds}
                          hasPendingMessages={showPendingMessages.length > 0}
                          forkingTurnId={forkingTurnId}
                          onFormSubmit={handleFormSubmit}
                          registerPendingForm={registerPendingForm}
                          onRewind={handleRewindRequest}
                          isBookmarked={isBookmarked}
                          onToggleBookmark={toggleBookmark}
                          splitEnabled={showTerminalSplit}
                        />
                        {activeTurn && [
                          <Turn
                            key={`${activeTurn.turn_id || 'g'}-${lastTurnIndex}`}
                            userMessage={activeTurn.userMessage}
                            attachments={activeTurn.attachments}
                            inlineReplies={activeTurn.inlineReplies}
                            note={activeTurn.note}
                            events={activeTurn.events}
                            turnId={activeTurn.turn_id}
                            todoDiffs={todoDiffs}
                            taskNotifications={taskNotifications}
                            resultStatus={
                              activeTurn.turn_id ? turnResults[activeTurn.turn_id] : null
                            }
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
                            isStopping={
                              interruptStatus === 'stopping' || interruptStatus === 'stopped'
                            }
                            hasNextUserMessage={false}
                            hasPendingMessages={showPendingMessages.length > 0}
                            duplicateAskUserIds={duplicateAskUserIds}
                            onFormSubmit={handleFormSubmit}
                            registerPendingForm={registerPendingForm}
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
                        {/* Pending turns from prior session activity are hidden during resume/replay, so
                    optimistic pending messages from session A don't bleed into session B on tab-switch.
                    The deferred-message Turn is its own render path and stays visible during boot. */}
                        <div className="chat-overlay-hoist">
                          {!(isResuming || isReplaying) &&
                            showPendingMessages.map((pm, i) => (
                              <Turn
                                key={`pending-${pm.id}`}
                                userMessage={pm.content}
                                attachments={pm.attachments}
                                inlineReplies={pm.inlineReplies}
                                note={pm.note}
                                events={[]}
                                pending={true}
                                hasNextUserMessage={true}
                                showProgress={
                                  i === showPendingMessages.length - 1 && !interruptStatus
                                }
                                isStopping={
                                  (interruptStatus === 'stopping' ||
                                    interruptStatus === 'stopped') &&
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
                    </HideShellCallsContext.Provider>
                  )}
                </div>
                {/* Held back while the loading screen is up: the minimap sits above the overlay in paint order, and its segments resize on every drained slice, so a resuming session would show a bar twitching over an otherwise still screen. */}
                {!(isMobile || showReplayOverlay) && (
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
              </div>
              {showTerminalSplit && (
                <>
                  <ChatSplitDivider
                    ratio={terminalSplit.ratio}
                    onRatioChange={setTerminalSplitRatio}
                  />
                  <TerminalColumn
                    entries={terminalEntries}
                    onEntryClick={handleTerminalEntryClick}
                  />
                </>
              )}
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
                  canInterrupt={showInterrupt}
                />
              )}
              <QuoteAffordance
                messagesRef={messagesRef}
                enabled={!(isMobile || showReplayOverlay)}
                onQuote={handleQuote}
              />
            </>
          )}
        </ErrorBoundary>
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
