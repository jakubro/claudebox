/** Main chat panel with conversation turns, input, and minimap navigation. */

// audit-ignore-file: file-size

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { interrupt } from '../../api/chat'
import { promoteSession } from '../../api/sessions'
import { getUiState, patchSessionUiState } from '../../api/uiState'
import ConfirmStopModal from '../../components/ConfirmStopModal.jsx'
import ErrorBoundary from '../../components/ErrorBoundary.jsx'
import { TaskKind } from '../../config/schema'
import {
  MOUNT_TIMEOUT_MS,
  SCROLL_SETTLE_MAX_FRAMES,
  SCROLL_SETTLE_STILL_FRAMES,
} from '../../config/timing'
import { useAppActions } from '../../context/AppActionsContext'
import { useBookmarksContext } from '../../context/BookmarksContext'
import { useDaemonStreamContext } from '../../context/DaemonStreamContext'
import { useEvents } from '../../context/EventsContext'
import { useInteraction } from '../../context/InteractionContext'
import { useSessionActions, useSessionData } from '../../context/SessionDataContext'
import { useSessionRouting } from '../../context/SessionRoutingContext'
import { useSessionsList } from '../../context/SessionsContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import useBackgroundWaiting from '../../hooks/useBackgroundWaiting'
import useCapabilities from '../../hooks/useCapabilities'
import useIsMobile from '../../hooks/useIsMobile'
import useNewSession from '../../hooks/useNewSession'
import useSessionOwnership from '../../hooks/useSessionOwnership'
import { useScrollElementRef } from '../../hooks/useVirtualListGeometry'
import { computeDuplicateAskUserIds, TurnRoutingMode } from '../../utils/eventProcessing'
import { pollFrames, withMountedTurn } from '../../utils/mountTurn'
import { isOpenFor, toggleOpenFor } from '../../utils/sessionOwnership'
import {
  findVisibleToolBlock,
  jumpToTask,
  jumpToTaskInTerminalColumn,
  jumpToTaskInWorkColumn,
} from '../../utils/taskScroll'
import ChatInputArea from './components/ChatInputArea'
import ChatSplitDivider from './components/ChatSplitDivider'
import ChatControlBar from './components/chat-control-bar'
import useComposerMaxHeight from './components/chat-input/hooks/useComposerMaxHeight'
import HistoricalTurnList from './components/HistoricalTurnList'
import { InlineThreadsOverlay, QuoteAffordance } from './components/inline-replies'
import useInlineReplies from './components/inline-replies/hooks/useInlineReplies'
import useInlineThreadSessions from './components/inline-replies/hooks/useInlineThreadSessions'
import TranscriptMiniMap from './components/minimap'
import QueuedMessageBubble from './components/QueuedMessageBubble'
import ReplayOverlay from './components/ReplayOverlay'
import RewindModal from './components/RewindModal'
import RightSlotColumns from './components/RightSlotColumns'
import SettingChangeDivider from './components/SettingChangeDivider'
import Turn from './components/turn'
import { FocusedMarksContext } from './components/turn/FocusedMarksContext'
import { useFocusedMarksFor } from './components/turn/hooks/useFocusedMarks'
import { TurnCollapseProvider } from './components/turn/TurnCollapseContext'
import { TurnRoutingContext } from './components/turn/TurnRoutingContext'
import { turnRecordProps } from './components/turn/utils/turnContent'
import WelcomeContent from './components/WelcomeContent'
import useActiveTurnReplies from './hooks/useActiveTurnReplies'
import useBookmarkJump from './hooks/useBookmarkJump'
import useChatController from './hooks/useChatController'
import useChatCreatingClear from './hooks/useChatCreatingClear'
import useChatRewindFork from './hooks/useChatRewindFork'
import { useColumnMinimapData } from './hooks/useColumnMinimapData'
import useColumnScroll from './hooks/useColumnScroll'
import useElementWidth from './hooks/useElementWidth'
import useMessageJump from './hooks/useMessageJump'
import useNotifications from './hooks/useNotifications'
import useTerminalJump from './hooks/useTerminalJump'
import { useTerminalSplitLayout } from './hooks/useTerminalSplitLayout'
import { useTurnJump } from './hooks/useTurnJump'
import useWorkJump from './hooks/useWorkJump'
import { useWorkPanelLiveState } from './hooks/useWorkPanelLiveState'
import { findTopmostVisibleTurn } from './utils/findTopmostVisibleTurn'
import { getOverlayStatusText } from './utils/overlayStatus'
import { tryRefocusChatTextarea } from './utils/refocusChatInput'
import { resolveControlBarTerminalProps } from './utils/resolveControlBarTerminalProps'
import { RightSlotView, resolveRightSlotRoutingMode } from './utils/rightSlotViews'
import { createRowSizeStore } from './utils/rowSizeStore'
import { dividerRows } from './utils/settingLabels'
import { deriveTerminalEntries } from './utils/terminalEvents'
import { buildTerminalMinimapBars } from './utils/terminalMinimapBars'
import { computeFoldBoundary } from './utils/turnFold'
import { buildWorkMinimapBars } from './utils/workMinimapBars'

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
    isCreateRequestPending,
    isResumeRequestPending,
    clearCreating,
    clearResume,
    startForking,
    clearForking,
  } = useEvents()
  const { isOwnerAttached, ownerSessionId } = useSessionOwnership()

  const { progressMessage } = useDaemonStreamContext()

  const { isSubmitting, interruptStatus, isAwaitingResponse, setError } = useInteraction()
  const { isWaiting, awaitingPickup, runningBackgroundWork } = useBackgroundWaiting()

  const { sessionData, sessionId, sessionName, workspace, notificationsEnabled, deferredBundle } =
    useSessionData()
  const { reloadSession } = useSessionActions()
  const {
    activeSessionId,
    activeTurnId,
    activeMessageType,
    activeTarget,
    navigateToSession,
    replaceTurnInUrl,
  } = useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { seedSession, sessions } = useSessionsList()
  const isSideThread = Boolean(sessions.find(s => s.session_id === sessionId)?.is_side_thread)
  const { isBookmarked, isTurnBookmarked, bookmarkedPartsOf, toggleBookmark } =
    useBookmarksContext()

  // Stable ref to events for ChatInput (avoids re-render from events subscription)
  const eventsRef = useRef(events)
  eventsRef.current = events

  // turnsRef lets the auto-collapse effect read current turns without turns as a dep (it churns every flush).
  const turnsRef = useRef(turns)
  turnsRef.current = turns

  // The last turn carries live events; earlier ones render via the memoized HistoricalTurnList.
  // Computed here so the minimap prices a promoted thread's fold from the same slice.
  const lastTurnIndex = turns.length - 1
  const activeTurn = turns.length > 0 ? turns[lastTurnIndex] : null
  const historicalTurns = turns.slice(0, -1)
  const foldBoundary = computeFoldBoundary(historicalTurns, isSideThread)
  // The panel outlives every session it shows: the fold belongs to the routed session it was opened in.
  const routedSessionRef = useRef(activeSessionId)
  routedSessionRef.current = activeSessionId
  const [expandedFor, setExpandedFor] = useState(null)
  const historicalExpanded = isOpenFor(expandedFor, activeSessionId)
  // Stable identity: an inline arrow defeats HistoricalTurnList's memo comparator, which compares
  // every prop by identity - the whole list then re-renders on every streaming flush.
  const toggleHistoricalExpanded = useCallback(
    () => setExpandedFor(prev => toggleOpenFor(prev, routedSessionRef.current)),
    [],
  )

  const {
    jumpPrevRef,
    jumpNextRef,
    jumpTopRef,
    jumpBottomRef,
    rightColumnPrevRef,
    rightColumnNextRef,
    chatScrollPositionRef,
    chatAutoScrollEnabledRef,
    autoCollapseEnabledRef,
    markUserIntentRef,
    markProgrammaticScrollRef,
    scrollToTurnRef,
    expandTurnRef,
    jumpToTaskRef,
    jumpToBookmarkRef,
    focusChatTab,
    focusedGroupRootRef,
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
    executeFork,
  } = useChatRewindFork({
    sessionId,
    routedSessionId: activeSessionId,
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
    pending: { showPendingMessages, sentTurnTimes },
    queue: {
      queueItems,
      enqueueMessage,
      editQueuedItem,
      cancelQueuedItem,
      requeueItem,
      sendNowItem,
    },
    deferred: { deferredSend, deferSend, returnedInput, clearReturnedInput },
    send,
  } = useChatController({
    events,
    contextRefs,
    activeTurnId,
  })

  // The transcript's own scroll element, reached via attachment rather than a per-commit mirror -
  // see useScrollElementRef. messagesRef.current keeps working for every other reader below.
  const [messagesEl, attachMessagesRef] = useScrollElementRef(messagesRef)

  // New-session workflow (welcome page deferred-send relies on this)
  const { executeNewSession } = useNewSession()

  // Filled by HistoricalTurnList so every jump can reach a windowed-out turn.
  const turnVirtualizerRef = useRef(null)

  // Off-bottom jumps disengage autoscroll; at-bottom jumps re-engage it.
  // root=panelRef.current scopes the row query - an ancestor rail group shares this row selector.
  const { jumpPrev, jumpNext, jumpTop, jumpBottom } = useMessageJump(
    messagesRef,
    markProgrammaticScroll,
    markUserIntent,
    markReturnedToBottom,
    turnVirtualizerRef,
    panelRef.current,
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

  // The one live ChatPanel registers its root so document-wide DOM lookups scope to it, not to
  // whichever rail group sits first in document order - always an ancestor, never the focused one.
  useEffect(() => {
    focusedGroupRootRef.current = panelRef.current
    return () => {
      focusedGroupRootRef.current = null
    }
  }, [focusedGroupRootRef, panelRef])

  // Sibling panels can't query a windowed-out turn in the DOM, so they hand the id here to mount it first.
  useEffect(() => {
    scrollToTurnRef.current = (turnId, onResolved) =>
      withMountedTurn({
        turnId,
        turns: turnsRef.current.slice(0, -1),
        virtualizer: turnVirtualizerRef.current,
        onResolved,
        root: panelRef.current,
      })
    return () => {
      scrollToTurnRef.current = null
    }
  }, [scrollToTurnRef, panelRef])

  // Auto-clears creating state once SSE connects, plus a timeout if it never reconnects (container failure).
  useChatCreatingClear({
    isCreating,
    isCreateRequestPending,
    isConnected,
    deferredSend,
    showPendingMessagesLength: showPendingMessages.length,
    turnsLength: turns.length,
    clearCreating,
  })

  // Timeout: auto-clear resuming if replay_ended never arrives (e.g. SSE reconnect failure); arms
  // only once the open request has settled, however long that takes.
  useEffect(() => {
    if (!isResuming || isResumeRequestPending) {
      return
    }
    const timer = setTimeout(() => {
      clearResume()
    }, 30000)
    return () => clearTimeout(timer)
  }, [isResuming, isResumeRequestPending, clearResume])

  const jumpToBookmark = useBookmarkJump({
    jumpToBookmarkRef,
    scrollToTurnRef,
    expandTurnRef,
    jumpToTaskRef,
    turnsRef,
    panelRef,
    messagesRef,
    markUserIntent,
    markProgrammaticScroll,
  })

  // Driven by useChatController, which forwards controller.onAutoScrollChange transitions into reactive state.
  const isAutoScrollEnabled = controllerAutoScrollEnabled
  const [minimapPinned, setMinimapPinned] = useState(true)
  // Independent of the transcript's own pin - its own toggle, its own persisted key. Same for work.
  const [terminalMinimapPinned, setTerminalMinimapPinned] = useState(true)
  const [workMinimapPinned, setWorkMinimapPinned] = useState(true)
  const isMobile = useIsMobile()
  const { runtimeName } = useCapabilities()
  // On desktop, MiniMap still renders when unpinned (auto-hide toggles a `visible` class on it).
  // The `minimap-pinned` className reserves layout space only when pinned and on desktop.
  const reserveMinimapSpace = minimapPinned && !isMobile

  // Pins toggled since the session's read was issued; its reply leaves those alone.
  const touchedPinsRef = useRef(new Set())

  // Pinned until the attached session's own values arrive; a reply for a session left is dropped.
  useEffect(() => {
    let cancelled = false
    touchedPinsRef.current = new Set()
    setMinimapPinned(true)
    setTerminalMinimapPinned(true)
    setWorkMinimapPinned(true)
    if (sessionId) {
      getUiState(sessionId)
        .then(data => {
          if (cancelled) {
            return
          }
          const pins = {
            minimapPinned: setMinimapPinned,
            terminalMinimapPinned: setTerminalMinimapPinned,
            workMinimapPinned: setWorkMinimapPinned,
          }
          for (const [key, setPinned] of Object.entries(pins)) {
            if (!touchedPinsRef.current.has(key)) {
              setPinned(data.session?.[key] ?? true)
            }
          }
        })
        .catch(err => console.warn('ChatPanel: getUiState failed', err))
    }

    return () => {
      cancelled = true
    }
  }, [sessionId])

  const handleToggleMinimap = useCallback(() => {
    touchedPinsRef.current.add('minimapPinned')
    setMinimapPinned(prev => {
      const next = !prev
      if (sessionId) {
        patchSessionUiState(sessionId, [{ op: 'set', path: 'minimapPinned', value: next }])
      }
      return next
    })
  }, [sessionId])

  const handleToggleTerminalMinimap = useCallback(() => {
    touchedPinsRef.current.add('terminalMinimapPinned')
    setTerminalMinimapPinned(prev => {
      const next = !prev
      if (sessionId) {
        patchSessionUiState(sessionId, [{ op: 'set', path: 'terminalMinimapPinned', value: next }])
      }
      return next
    })
  }, [sessionId])

  const handleToggleWorkMinimap = useCallback(() => {
    touchedPinsRef.current.add('workMinimapPinned')
    setWorkMinimapPinned(prev => {
      const next = !prev
      if (sessionId) {
        patchSessionUiState(sessionId, [{ op: 'set', path: 'workMinimapPinned', value: next }])
      }
      return next
    })
  }, [sessionId])

  // Read for the owner: the attached id is still empty when replay ends.
  // Keyed on that id, the transcript would draw before its view is read.
  // Not before a workspace is picked: that read fails and holds Focused until another session opens.
  // A width-driven collapse leaves the preference alone.
  const viewSessionId = workspaceId ? ownerSessionId : null
  const { contentAreaRef, terminalSplit, activeView, setRightSlotView, setTerminalSplitRatio } =
    useTerminalSplitLayout(viewSessionId, isMobile)
  const showTerminalSplit = activeView?.id === RightSlotView.TERMINAL
  const showWorkView = activeView?.id === RightSlotView.WORK
  // Computed once for both consumers: the minimap renders outside the Provider below, so it cannot
  // read the context - deriving the mode twice would let the two desync.
  const routingMode = resolveRightSlotRoutingMode(terminalSplit?.view, activeView, isMobile)
  // A thread's calls never reach the right column, so its turns take only Focused's hiding.
  const threadRoutingMode =
    routingMode === TurnRoutingMode.FOCUSED ? TurnRoutingMode.FOCUSED : TurnRoutingMode.OFF
  const focusedMarks = useFocusedMarksFor(runtimeName, !isMobile)
  const controlBarTerminalProps = resolveControlBarTerminalProps(viewSessionId, terminalSplit)
  // The transcript mounts only once the session's view is read, so a replay that ends first must
  // not yet land a linked turn or settle at the bottom - there is nothing drawn to move.
  const transcriptPending = isReplaying || controlBarTerminalProps.hydratingTerminalSplit

  // Also runs the cross-session replay jump.
  const { scrollToTurnAndHighlight, handleTerminalEntryClick } = useTurnJump({
    turnsRef,
    turnVirtualizerRef,
    messagesRef,
    chatAutoScrollEnabledRef,
    isReplaying: transcriptPending,
    activeTurnId,
    activeMessageType,
    activeTarget,
    jumpToBookmark,
  })
  const terminalEntries = useMemo(() => deriveTerminalEntries(events), [events])

  // One scroll-position controller per right-slot column, owned here because every consumer of
  // that state is the column's sibling rather than its child - see useColumnScroll.
  const {
    containerRef: terminalContainerRef,
    isAutoScrollEnabled: terminalAutoScrollEnabled,
    isAutoScrollEnabledRef: terminalAutoScrollEnabledRef,
    handleScroll: handleTerminalScroll,
    scrollToBottom: scrollTerminalToBottom,
    markUserIntent: markTerminalUserIntent,
    markReturnedToBottom: markTerminalReturnedToBottom,
    markProgrammaticScroll: markTerminalProgrammaticScroll,
  } = useColumnScroll(sessionId, isReplaying, showTerminalSplit, 'terminal')

  const {
    containerRef: workContainerRef,
    isAutoScrollEnabled: workAutoScrollEnabled,
    isAutoScrollEnabledRef: workAutoScrollEnabledRef,
    handleScroll: handleWorkScroll,
    scrollToBottom: scrollWorkToBottom,
    markUserIntent: markWorkUserIntent,
    markReturnedToBottom: markWorkReturnedToBottom,
    markProgrammaticScroll: markWorkProgrammaticScroll,
  } = useColumnScroll(sessionId, isReplaying, showWorkView, 'work')

  // Re-engages the latch first, since scrollToBottom() is itself gated on it being already on.
  const handleTerminalJumpToBottom = useCallback(() => {
    markTerminalReturnedToBottom()
    scrollTerminalToBottom()
  }, [markTerminalReturnedToBottom, scrollTerminalToBottom])

  const handleWorkJumpToBottom = useCallback(() => {
    markWorkReturnedToBottom()
    scrollWorkToBottom()
  }, [markWorkReturnedToBottom, scrollWorkToBottom])

  // Filled by WorkColumn so step navigation can reach a windowed-out turn.
  const workVirtualizerRef = useRef(null)

  const {
    metricsCacheRef: terminalMetricsCacheRef,
    bars: terminalBars,
    getAutoScrollEnabled: getTerminalAutoScrollEnabled,
    getLogicalScrollHeight: getTerminalLogicalScrollHeight,
    handleMinimapLanding: handleTerminalMinimapLanding,
  } = useColumnMinimapData({
    items: terminalEntries,
    buildBars: buildTerminalMinimapBars,
    autoScrollEnabledRef: terminalAutoScrollEnabledRef,
    markUserIntent: markTerminalUserIntent,
    markReturnedToBottom: markTerminalReturnedToBottom,
  })

  // Column width for the work overview's own bar pricing - the same wrap-aware prediction the
  // virtualizer uses, so the overview and the column can never disagree about proportions.
  const workEffectiveWidth = useElementWidth(workContainerRef)
  const buildWorkBars = useCallback(
    (items, cacheRef) =>
      buildWorkMinimapBars(items, Math.max(0, workEffectiveWidth || 0), routingMode, cacheRef),
    [workEffectiveWidth, routingMode],
  )
  const {
    metricsCacheRef: workMetricsCacheRef,
    bars: workBars,
    getAutoScrollEnabled: getWorkAutoScrollEnabled,
    getLogicalScrollHeight: getWorkLogicalScrollHeight,
    handleMinimapLanding: handleWorkMinimapLanding,
  } = useColumnMinimapData({
    items: turns,
    buildBars: buildWorkBars,
    autoScrollEnabledRef: workAutoScrollEnabledRef,
    markUserIntent: markWorkUserIntent,
    markReturnedToBottom: markWorkReturnedToBottom,
  })

  // Filled by TerminalColumn so step navigation can reach a windowed-out entry, and the newest one.
  const terminalVirtualizerRef = useRef(null)
  const terminalTrailingEntryRef = useRef(null)

  // Alt+PageUp/PageDown step the terminal's entries, transitioning its scroll owner rather than
  // writing that state directly. See useTerminalJump for why it gets no jump-to-end control.
  const { stepPrev: terminalJumpPrev, stepNext: terminalJumpNext } = useTerminalJump({
    containerRef: terminalContainerRef,
    virtualizerRef: terminalVirtualizerRef,
    trailingEntryRef: terminalTrailingEntryRef,
    markProgrammaticScroll: markTerminalProgrammaticScroll,
    markUserIntent: markTerminalUserIntent,
    markReturnedToBottom: markTerminalReturnedToBottom,
  })

  // Alt+PageUp/PageDown step the work column's turns, skipping any that routed nothing away.
  const { stepPrev: workJumpPrev, stepNext: workJumpNext } = useWorkJump({
    containerRef: workContainerRef,
    virtualizerRef: workVirtualizerRef,
    turns,
    mode: routingMode,
    markProgrammaticScroll: markWorkProgrammaticScroll,
    markUserIntent: markWorkUserIntent,
    markReturnedToBottom: markWorkReturnedToBottom,
  })

  // The right split slot's binding, not either column's, so hiding a column - by toggle or by a
  // width collapse - clears it rather than leaving it pointed at a dead closure.
  useEffect(() => {
    if (showTerminalSplit) {
      rightColumnPrevRef.current = terminalJumpPrev
      rightColumnNextRef.current = terminalJumpNext
    } else if (showWorkView) {
      rightColumnPrevRef.current = workJumpPrev
      rightColumnNextRef.current = workJumpNext
    } else {
      return undefined
    }
    return () => {
      rightColumnPrevRef.current = null
      rightColumnNextRef.current = null
    }
  }, [
    showTerminalSplit,
    showWorkView,
    terminalJumpPrev,
    terminalJumpNext,
    workJumpPrev,
    workJumpNext,
    rightColumnPrevRef,
    rightColumnNextRef,
  ])

  const composerHandleRef = useRef(null)
  const quoteShowingRef = useRef(false)
  const autocompleteOpenRef = useRef(false)
  const focusComposer = useCallback(() => composerHandleRef.current?.focus(), [])
  // Read at call time, so the handle's per-keystroke churn never re-renders the reply boxes.
  const sendFromReplyBox = useCallback(() => {
    composerHandleRef.current?.submit()
    composerHandleRef.current?.focus()
  }, [])
  const handleEditReply = useCallback(label => composerHandleRef.current?.replaceInput(label), [])

  // A failed creation's input goes back into the composer, and its first-message bubble goes away.
  useEffect(() => {
    if (!returnedInput) {
      return
    }
    composerHandleRef.current?.returnInput(returnedInput)
    clearReturnedInput()
  }, [returnedInput, clearReturnedInput])

  // {hasSelection, submit} for the active turn's live form; Enter in the composer submits it.
  // Only one turn awaits an answer, so ToolBlock's register/unregister is last-writer-wins.
  const pendingFormRef = useRef(null)
  const registerPendingForm = useCallback(entry => {
    pendingFormRef.current = entry
  }, [])
  // The unsent buffer persists per session; sent replies re-hydrate from turns, with no side bar.
  const {
    unsent: inlineRepliesUnsent,
    add: addInlineReply,
    editReply: editInlineReply,
    remove: removeInlineReply,
    claimWireReplies: claimInlineWireReplies,
    settleClaim: settleInlineRepliesClaim,
    hasSendable: hasBufferedReplies,
    markAsked: markInlineReplyAsked,
    linkThreadSession,
    linkPromotedSession,
    linkRailPromotion,
    unsentRef: inlineRepliesUnsentRef,
  } = useInlineReplies(sessionId)
  // The session the reply buffer holds: it reloads one commit after the id changes, and the overlay
  // remounts on it so the loaded buffer is adopted as restored, not as freshly quoted.
  const [repliesSessionId, setRepliesSessionId] = useState(sessionId)
  useEffect(() => {
    setRepliesSessionId(sessionId)
  }, [sessionId])

  // Side-thread sessions for floats asked on their own - forked into the same container, never
  // touching the main transcript. See docs/ARCHITECTURE.md section 1.5, per-thread submit.
  const {
    threads: inlineThreads,
    submit: submitInlineThread,
    load: loadInlineThread,
    interruptThread: interruptInlineThread,
    detach: detachInlineThread,
    releaseAll: releaseInlineThreads,
  } = useInlineThreadSessions(containerId)

  const handleSubmitInlineThread = useCallback(
    (replyId, text) => {
      const reply = inlineRepliesUnsentRef.current.find(r => r.id === replyId)
      if (!(reply && sessionId && text?.trim())) {
        return
      }
      const ownerSessionId = sessionId
      markInlineReplyAsked(replyId)
      submitInlineThread(reply, sessionId, text).then(newSessionId => {
        if (newSessionId && !reply.threadSessionId) {
          linkThreadSession(replyId, newSessionId, ownerSessionId)
        }
      })
    },
    [
      inlineRepliesUnsentRef,
      sessionId,
      markInlineReplyAsked,
      submitInlineThread,
      linkThreadSession,
    ],
  )

  // Promote a side thread into its own tab. Stop first: the fork copies the transcript from disk.
  // Parent is the main conversation - a side thread is never drawn. The float re-reads the log.
  const handlePromoteThread = useCallback(
    async replyId => {
      const reply = inlineRepliesUnsentRef.current.find(r => r.id === replyId)
      if (!(reply?.threadSessionId && sessionId) || reply.promotedSessionId) {
        return
      }
      const sideSessionId = reply.threadSessionId
      const ownerSessionId = sessionId
      const result = await executeFork(null, 'fork-browser-tab', {
        sourceId: sideSessionId,
        parentSessionId: sessionId,
        stopSourceFirst: true,
        failureMessage: 'Promote failed',
      })
      if (!result?.session_id) {
        return
      }
      detachInlineThread(replyId)
      await loadInlineThread(replyId, sideSessionId)
      linkPromotedSession(replyId, result.session_id, ownerSessionId)
      if (!result.tabOpened) {
        setError('Popup blocked - open the promoted session from the sessions panel')
      }
    },
    [
      inlineRepliesUnsentRef,
      sessionId,
      executeFork,
      detachInlineThread,
      loadInlineThread,
      linkPromotedSession,
      setError,
    ],
  )

  // Promote a side thread onto the rail: same session, no fork - its auto-stop disposition clears.
  // The rail derives ancestry from parentage, so navigating to the thread's id is the whole job.
  const handlePromoteThreadToRail = useCallback(
    async replyId => {
      const reply = inlineRepliesUnsentRef.current.find(r => r.id === replyId)
      if (!(reply?.threadSessionId && sessionId && workspaceId) || reply.railPromoted) {
        return
      }
      const sideSessionId = reply.threadSessionId
      const ownerSessionId = sessionId
      try {
        await promoteSession(sideSessionId)
      } catch {
        setError('Promote failed')
        return
      }
      // The origin session's own subscription to this thread is redundant the moment the thread
      // becomes the rail's own live group, which mounts its own ChatPanel and its own stream.
      detachInlineThread(replyId)
      linkRailPromotion(replyId, ownerSessionId)
      navigateToSession(workspaceId, sideSessionId)
    },
    [
      inlineRepliesUnsentRef,
      sessionId,
      workspaceId,
      detachInlineThread,
      linkRailPromotion,
      navigateToSession,
      setError,
    ],
  )

  // The rail-promoted read-only card's own control - clicking its quote's highlight does the same.
  const handleFocusRailPromoted = useCallback(
    threadSessionId => {
      if (workspaceId) {
        navigateToSession(workspaceId, threadSessionId)
      }
    },
    [workspaceId, navigateToSession],
  )

  // Re-attach on mount/reload: a buffered reply linked to a side session but missing from this
  // render's thread state re-reads its log, re-subscribing if the reader left mid-answer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: inlineThreads/loadInlineThread would loop; this only needs to catch newly-linked ids
  useEffect(() => {
    for (const reply of inlineRepliesUnsent) {
      if (reply.threadSessionId && !inlineThreads.has(reply.id)) {
        loadInlineThread(reply.id, reply.threadSessionId)
      }
    }
  }, [inlineRepliesUnsent])

  // A session switch tears down every open subscription - a stale float must never keep
  // streaming into a session the reader has navigated away from.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the re-run trigger, unused in the body
  useEffect(() => {
    return () => releaseInlineThreads()
  }, [sessionId, releaseInlineThreads])

  // Folds buffered inline replies into one turn with the composer prompt + attachments; no-op if empty.
  // content=prompt (never the serialized XML) keeps the optimistic pending turn reconcilable.
  // The replies are claimed for this send, so no other send can carry them while it is on its way.
  const sendWithInlineReplies = useCallback(
    async (content, opts = {}) => {
      const claim = claimInlineWireReplies()
      const hasContent = typeof content === 'string' ? content.trim() : content
      if (!(hasContent || opts.attachments?.length) && claim.ids.length === 0) {
        return undefined
      }
      let sent = false
      try {
        sent = await send(content, {
          ...opts,
          inlineReplies: claim.wire.length > 0 ? claim.wire : null,
        })
      } finally {
        settleInlineRepliesClaim(claim, sent)
      }
      return sent
    },
    [send, claimInlineWireReplies, settleInlineRepliesClaim],
  )

  // Affordance click: capture the quote; the highlight + docked box appear via the overlay.
  const handleQuote = useCallback(quote => addInlineReply(quote), [addInlineReply])

  // Composer max height, shared with the inline reply boxes' autoresize.
  const composerMaxHeight = useComposerMaxHeight(panelRef)

  // Sourced from transcript turns (durable) plus just-sent pending messages, so a fresh send docks immediately.
  // Each reply carries its source-turn anchor, so the overlay docks it at that block, and keeps its
  // unsent id; one sent without an id takes its position instead.
  const sentInlineThreads = useMemo(() => {
    const fromTurns = turns.flatMap(t =>
      (t.inlineReplies || []).map((r, i) => ({ id: `${t.turn_id}:reply:${i}`, ...r })),
    )
    const fromPending = showPendingMessages.flatMap((pm, pi) =>
      (pm.inlineReplies || []).map((r, i) => ({ id: `pending:${pi}:${i}`, ...r })),
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

  const collapsedTurnIdsRef = useRef(collapsedTurnIds)
  collapsedTurnIdsRef.current = collapsedTurnIds

  // The hand-expand memory is written before the update is queued: an auto-collapse recompute
  // landing in the same flush must already see it, or it re-collapses the turn.
  const setTurnExpandedByHand = useCallback((turnId, expanded) => {
    if (expanded) {
      manuallyExpandedIdsRef.current.add(turnId)
    } else {
      manuallyExpandedIdsRef.current.delete(turnId)
    }
    setCollapsedTurnIds(prev => {
      if (prev.has(turnId) !== expanded) {
        return prev
      }
      const next = new Set(prev)
      if (expanded) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return next
    })
  }, [])

  const handleToggleTurnCollapse = useCallback(
    turnId => setTurnExpandedByHand(turnId, collapsedTurnIdsRef.current.has(turnId)),
    [setTurnExpandedByHand],
  )

  // Sibling panels open a turn through this, counting as a hand-expand so it does not re-collapse.
  useEffect(() => {
    expandTurnRef.current = turnId => {
      if (turnId) {
        setTurnExpandedByHand(turnId, true)
      }
    }
    return () => {
      expandTurnRef.current = null
    }
  }, [expandTurnRef, setTurnExpandedByHand])

  // The Tasks panel reaches a task's tool block through this - the work view routes every
  // top-level call out of the transcript, so the landing column depends on which one is active.
  useEffect(() => {
    jumpToTaskRef.current = task => {
      if (showTerminalSplit && task.kind === TaskKind.COMMAND) {
        jumpToTaskInTerminalColumn(
          terminalEntries.findIndex(e => e.id === task.id),
          task.id,
          {
            container: terminalContainerRef.current,
            virtualizer: terminalVirtualizerRef.current,
            root: panelRef.current,
            markUserIntent: markTerminalUserIntent,
            markProgrammaticScroll: markTerminalProgrammaticScroll,
            markReturnedToBottom: markTerminalReturnedToBottom,
          },
        )
        return
      }
      if (showWorkView) {
        const turnIndex = turns.findIndex(t => t.turn_id === task.turnId)
        if (turnIndex < 0) {
          return
        }
        jumpToTaskInWorkColumn(turnIndex, task.id, {
          container: workContainerRef.current,
          virtualizer: workVirtualizerRef.current,
          root: panelRef.current,
          markUserIntent: markWorkUserIntent,
          markProgrammaticScroll: markWorkProgrammaticScroll,
          markReturnedToBottom: markWorkReturnedToBottom,
        })
        return
      }

      // Expanding and jumping are independent - a task may need either, both, or neither.
      const proceed = () => {
        if (task.turnId && collapsedTurnIds.has(task.turnId)) {
          handleToggleTurnCollapse(task.turnId)
        }
        pollFrames(
          MOUNT_TIMEOUT_MS,
          () => findVisibleToolBlock(task.id, panelRef.current, { reveal: task.reveal }),
          el => {
            if (el) {
              jumpToTask(el, messagesRef.current, {
                markUserIntent,
                markProgrammaticScroll,
                highlightClass: task.highlightClass,
                highlightMs: task.highlightMs,
              })
            }
          },
        )
      }

      // Fast path: a running task's turn is never windowed or collapsed, so it's mounted.
      if (
        (panelRef.current ?? document).querySelector(
          `[data-tool-use-id="${CSS.escape(String(task.id))}"]`,
        )
      ) {
        proceed()
        return
      }

      // Windowed out, turn id known: mount it first via scrollToTurnRef.
      if (task.turnId && scrollToTurnRef.current) {
        scrollToTurnRef.current(task.turnId, turnEl => {
          if (turnEl) {
            proceed()
          }
        })
      }

      // Unresolvable (no turn id, or absent from the historical array): no crash, no jump.
    }
    return () => {
      jumpToTaskRef.current = null
    }
  }, [
    jumpToTaskRef,
    showTerminalSplit,
    terminalEntries,
    terminalContainerRef,
    markTerminalUserIntent,
    markTerminalProgrammaticScroll,
    markTerminalReturnedToBottom,
    showWorkView,
    turns,
    workContainerRef,
    panelRef,
    markWorkUserIntent,
    markWorkProgrammaticScroll,
    markWorkReturnedToBottom,
    collapsedTurnIds,
    handleToggleTurnCollapse,
    messagesRef,
    markUserIntent,
    markProgrammaticScroll,
    scrollToTurnRef,
  ])

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

  // Mirrors autoscroll's session reset - a new session opens with only the last turn shown. Keyed on the
  // routed owner, known before the session id settles, so a link's expand made meanwhile survives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownerSessionId is the reset trigger
  useEffect(() => {
    autoCollapseEnabledRef.current = true
    setAutoCollapseEnabled(true)
    manuallyExpandedIdsRef.current.clear()
  }, [ownerSessionId, autoCollapseEnabledRef])

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

  // Written by the turn list as it measures, read by the minimap - so a measurement re-renders only
  // the minimap, never this panel.
  const [rowSizes] = useState(createRowSizeStore)

  // Turns land with estimated heights; windowed rows swap in real heights over several frames, so
  // re-scroll every frame until scrollHeight holds for a few, capped so an animation can't stall it.
  // Keyed on turns.length, not an isReplaying edge: React can fold a whole replay into one commit.
  // Skipped until the transcript draws (refires then) and when the URL names a turn (races that link).
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns.length is a deliberate trigger (see below)
  useEffect(() => {
    if (transcriptPending || activeTurnId) {
      return undefined
    }

    let id
    let lastHeight = -1
    let lastScrollTop = -1
    let framesLeft = SCROLL_SETTLE_MAX_FRAMES
    let stillFrames = 0
    const settle = () => {
      const el = messagesRef.current
      if (!el) {
        return
      }
      // The settle loop never shrinks scrollTop, so a drop means something outside repositioned
      // the view (e.g. a scrollTop write bypassing markUserIntent); back off rather than fight it.
      if (lastScrollTop >= 0 && el.scrollTop < lastScrollTop) {
        return
      }

      scrollToBottom()
      framesLeft -= 1
      lastScrollTop = el.scrollTop
      const height = el.scrollHeight
      stillFrames = height === lastHeight ? stillFrames + 1 : 0
      lastHeight = height
      if (framesLeft > 0 && stillFrames < SCROLL_SETTLE_STILL_FRAMES) {
        id = requestAnimationFrame(settle)
      }
    }
    id = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(id)
  }, [turns.length, transcriptPending, activeTurnId, scrollToBottom, messagesRef])

  // Desktop notifications and sound when response completes while tab is hidden
  useNotifications({
    isResponding: isResponding || awaitingPickup,
    isWaiting,
    isReplaying,
    events,
    sessionName,
    workspace,
    notificationsEnabled,
    canNeedUser: !sessionData?.spawned_from_session_id,
  })

  // Cross-turn dedup: hide errored AskUserQuestion retries (same question headers)
  const duplicateAskUserIds = useMemo(() => computeDuplicateAskUserIds(turns), [turns])

  // Extracted to keep ChatPanel below the cognitive-complexity gate.
  const { isActiveTurnResponding, workPanelNow } = useWorkPanelLiveState({
    isResponding: isResponding || awaitingPickup,
    isAwaitingResponse,
    interruptStatus,
    pendingMessageCount: showPendingMessages.length,
    showWorkView,
  })

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

  // Interrupt handler; never while the session on screen is not yet the one the tab addresses
  const showInterrupt =
    isOwnerAttached &&
    (isResponding ||
      showPendingMessages.length > 0 ||
      queueItems.length > 0 ||
      isSubmitting ||
      isAwaitingResponse)

  const overlayComposer = useMemo(
    () => ({
      canInterrupt: showInterrupt,
      focus: focusComposer,
      send: sendFromReplyBox,
      quoteShowingRef,
      autocompleteOpenRef,
    }),
    [showInterrupt, focusComposer, sendFromReplyBox],
  )

  // extractOrEmpty tolerates an empty composer, so the no-note case needs no branch.
  // sendWithInlineReplies also folds in buffered inline replies and clears the composer.
  const handleFormSubmit = useCallback(
    async answer => {
      const payload = composerHandleRef.current?.extractOrEmpty?.() ?? {
        rawPrompt: '',
        currentAttachments: [],
      }
      const sent = await sendWithInlineReplies(answer, {
        attachments: payload.currentAttachments,
        note: payload.rawPrompt,
      })
      if (!sent) {
        composerHandleRef.current?.restoreInput?.(payload)
      }
      // The clicked Submit or reply button has unmounted, leaving the cursor on the page - unless
      // the reader has put it in another field while the answer was sending.
      if (document.activeElement === document.body) {
        composerHandleRef.current?.focus()
      }
    },
    [sendWithInlineReplies],
  )

  const activeReplies = useActiveTurnReplies(
    sessionData,
    activeSessionId,
    activeTurn?.events,
    showPendingMessages.length > 0,
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
      autocompleteOpen: autocompleteOpenRef,
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

  // Reload guard: confirm when Claude is responding. Shown only for the session it was opened in.
  const [pendingReloadFor, setPendingReloadFor] = useState(null)
  const pendingReload = isOpenFor(pendingReloadFor, activeSessionId)

  const handleReload = useCallback(() => {
    if (isResponding) {
      setPendingReloadFor(routedSessionRef.current)
      return
    }
    reloadSession()
  }, [isResponding, reloadSession])

  const handleReloadConfirm = useCallback(async () => {
    setPendingReloadFor(null)
    await interrupt()
    reloadSession()
  }, [reloadSession])

  const handleReloadCancel = useCallback(() => {
    setPendingReloadFor(null)
  }, [])

  // Leaving a session closes what was open in it, so a return shows it folded and unprompted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeSessionId is the reset trigger
  useEffect(() => {
    setExpandedFor(null)
    setPendingReloadFor(null)
  }, [activeSessionId])

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
      executeNewSession(deferredBundle)
      deferSend(trimmed || '', attachments || [])
    },
    [executeNewSession, deferSend, deferredBundle],
  )

  // Mirrors inputState above. onWelcomeDeferSend is the welcome->active bridge; the rest forward unchanged.
  const inputActions = {
    send: sendWithInlineReplies,
    enqueueMessage,
    deferSend,
    onWelcomeDeferSend: handleWelcomeDeferSend,
    hasBufferedReplies,
  }

  const activeResultStatus = activeTurn?.turn_id ? turnResults[activeTurn.turn_id] : null
  const activeWaitingOn =
    isWaiting && !interruptStatus && showPendingMessages.length === 0 ? runningBackgroundWork : null

  const isTranscriptEmpty =
    turns.length === 0 &&
    showPendingMessages.length === 0 &&
    queueItems.length === 0 &&
    !deferredSend &&
    !isCreating

  return (
    <div className="chat-panel" ref={panelRef} data-testid="panel-chat">
      {/* hydratingTerminalSplit covers the async hydration window (every session change, not only
          mount) - without it the bar would paint whole for one frame, then divide. */}
      {!(isWelcome || showReplayOverlay || controlBarTerminalProps.hydratingTerminalSplit) && (
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
          rightSlotView={controlBarTerminalProps.rightSlotView}
          onSelectRightSlotView={setRightSlotView}
          showTerminalSplit={showTerminalSplit}
          showWorkView={showWorkView}
          terminalSplitRatio={controlBarTerminalProps.terminalSplitRatio}
          terminalAutoScrollEnabled={terminalAutoScrollEnabled}
          onTerminalJumpToBottom={handleTerminalJumpToBottom}
          onTerminalJumpPrev={terminalJumpPrev}
          onTerminalJumpNext={terminalJumpNext}
          terminalMinimapPinned={terminalMinimapPinned}
          onToggleTerminalMinimap={handleToggleTerminalMinimap}
          workAutoScrollEnabled={workAutoScrollEnabled}
          onWorkJumpToBottom={handleWorkJumpToBottom}
          onWorkJumpPrev={workJumpPrev}
          onWorkJumpNext={workJumpNext}
          workMinimapPinned={workMinimapPinned}
          onToggleWorkMinimap={handleToggleWorkMinimap}
        />
      )}
      <div className="chat-content-area" ref={contentAreaRef}>
        <FocusedMarksContext.Provider value={focusedMarks}>
          <ErrorBoundary label="chat-transcript" resetKey={sessionId}>
            {isWelcome ? (
              <WelcomeContent />
            ) : (
              <>
                {/* Rendered before .chat-transcript-column, not after the right slot: the sibling
                  rules below key off `~`, which matches only following siblings. */}
                {showReplayOverlay && (
                  <ReplayOverlay
                    isCreating={isCreating}
                    replayProgress={replayProgress}
                    replayTotal={replayTotal}
                    statusText={overlayStatusText}
                  />
                )}
                <div
                  className="chat-transcript-column"
                  style={
                    showTerminalSplit || showWorkView
                      ? {
                          flexGrow: 0,
                          flexShrink: 0,
                          flexBasis: `${(terminalSplit.ratio * 100).toFixed(4)}%`,
                        }
                      : undefined
                  }>
                  <div
                    className={`chat-messages${reserveMinimapSpace ? ' minimap-pinned' : ''}`}
                    ref={attachMessagesRef}
                    onScroll={wrappedHandleScroll}
                    onPointerDown={handleMessagesPointerDown}
                    onClick={handleMessagesClick}
                    tabIndex={-1}
                    data-testid="chat-messages">
                    {controlBarTerminalProps.hydratingTerminalSplit ? null : isTranscriptEmpty ? (
                      <p className="chat-empty">Waiting for messages...</p>
                    ) : (
                      <TurnRoutingContext.Provider value={routingMode}>
                        <TurnCollapseProvider
                          collapsedTurnIds={collapsedTurnIds}
                          onToggleTurnCollapse={handleToggleTurnCollapse}>
                          <HistoricalTurnList
                            messagesEl={messagesEl}
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
                            bookmarkedPartsOf={bookmarkedPartsOf}
                            onToggleBookmark={toggleBookmark}
                            isSideThread={isSideThread}
                            expanded={historicalExpanded}
                            onToggleExpanded={toggleHistoricalExpanded}
                            rowSizes={rowSizes}
                          />
                          {activeTurn && [
                            <Turn
                              key={`${activeTurn.turn_id || 'g'}-${lastTurnIndex}`}
                              {...turnRecordProps(activeTurn)}
                              sentAt={sentTurnTimes[activeTurn.turn_id] ?? null}
                              sharesRunningStart
                              todoDiffs={todoDiffs}
                              taskNotifications={taskNotifications}
                              resultStatus={activeResultStatus}
                              interrupted={activeTurn.interrupted}
                              isActive={isActiveTurnResponding}
                              showProgress={isActiveTurnResponding}
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
                              bookmarkedParts={bookmarkedPartsOf(activeTurn.turn_id)}
                              onToggleBookmark={toggleBookmark}
                              waitingOn={activeWaitingOn}
                              replies={activeReplies}
                              onReply={handleFormSubmit}
                              onEditReply={handleEditReply}
                            />,
                            ...dividerRows(activeTurn.settingChanges || []).map((row, ri) => (
                              <SettingChangeDivider
                                key={`sc-${lastTurnIndex}-${ri}`}
                                events={row}
                              />
                            )),
                          ]}
                          {/* Pending turns from prior session activity are hidden during
                            resume/replay, so optimistic pending messages from session A don't bleed
                            into session B on tab-switch. The deferred-message Turn is its own
                            render path and stays visible during boot. */}
                          <div className="chat-overlay-hoist">
                            {!(isResuming || isReplaying) &&
                              showPendingMessages.map((pm, i) => (
                                <Turn
                                  key={`pending-${pm.id}`}
                                  userMessage={pm.content}
                                  attachments={pm.attachments}
                                  inlineReplies={pm.inlineReplies}
                                  note={pm.note}
                                  sentAt={pm.sentAt}
                                  sharesRunningStart
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
                                  isCompacting={
                                    i === showPendingMessages.length - 1 && isCompacting
                                  }
                                />
                              ))}
                            {deferredSend && showPendingMessages.length === 0 && (
                              <Turn
                                key="deferred"
                                userMessage={deferredSend.content}
                                attachments={deferredSend.attachments}
                                sentAt={deferredSend.sentAt}
                                sharesRunningStart
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
                      </TurnRoutingContext.Provider>
                    )}
                  </div>
                  {/* Held back while the loading screen is up: the minimap paints above the overlay
                    and resizes on every drained slice, so it would twitch over a still screen. And
                    until the transcript mounts, since it measures the live turn's element once. */}
                  {!(isMobile || showReplayOverlay || transcriptPending) && (
                    <TranscriptMiniMap
                      turns={turns}
                      messagesRef={messagesRef}
                      collapsedTurnIds={collapsedTurnIds}
                      routingMode={routingMode}
                      foldBoundary={foldBoundary}
                      foldExpanded={historicalExpanded}
                      rowSizes={rowSizes}
                      bookmarkedPartsOf={bookmarkedPartsOf}
                      isMarked={focusedMarks.isMarked}
                      turnResults={turnResults}
                      pendingCount={showPendingMessages.length}
                      autoScrollEnabledRef={chatAutoScrollEnabledRef}
                      persistent={minimapPinned}
                      isStreaming={isResponding}
                      isTurnBookmarked={isTurnBookmarked}
                    />
                  )}
                </div>
                {(showTerminalSplit || showWorkView) && (
                  <>
                    <ChatSplitDivider
                      ratio={terminalSplit.ratio}
                      onRatioChange={setTerminalSplitRatio}
                    />
                    <div className="chat-right-slot">
                      <RightSlotColumns
                        showTerminalSplit={showTerminalSplit}
                        showWorkView={showWorkView}
                        showReplayOverlay={showReplayOverlay}
                        isMobile={isMobile}
                        terminalEntries={terminalEntries}
                        onTerminalEntryClick={handleTerminalEntryClick}
                        terminalContainerRef={terminalContainerRef}
                        terminalVirtualizerRef={terminalVirtualizerRef}
                        terminalTrailingEntryRef={terminalTrailingEntryRef}
                        onTerminalScroll={handleTerminalScroll}
                        scrollTerminalToBottom={scrollTerminalToBottom}
                        terminalMetricsCacheRef={terminalMetricsCacheRef}
                        terminalMinimapPinned={terminalMinimapPinned}
                        terminalBars={terminalBars}
                        getTerminalAutoScrollEnabled={getTerminalAutoScrollEnabled}
                        getTerminalLogicalScrollHeight={getTerminalLogicalScrollHeight}
                        onTerminalMinimapLanding={handleTerminalMinimapLanding}
                        turns={turns}
                        mode={routingMode}
                        activeTurnId={activeTurn?.turn_id ?? null}
                        isActive={isActiveTurnResponding}
                        now={workPanelNow}
                        todoDiffs={todoDiffs}
                        taskNotifications={taskNotifications}
                        duplicateAskUserIds={duplicateAskUserIds}
                        hasPendingMessages={showPendingMessages.length > 0}
                        onFormSubmit={handleFormSubmit}
                        registerPendingForm={registerPendingForm}
                        onEntryJump={scrollToTurnAndHighlight}
                        workContainerRef={workContainerRef}
                        workVirtualizerRef={workVirtualizerRef}
                        onWorkScroll={handleWorkScroll}
                        scrollWorkToBottom={scrollWorkToBottom}
                        workMetricsCacheRef={workMetricsCacheRef}
                        workMinimapPinned={workMinimapPinned}
                        workBars={workBars}
                        getWorkAutoScrollEnabled={getWorkAutoScrollEnabled}
                        getWorkLogicalScrollHeight={getWorkLogicalScrollHeight}
                        onWorkMinimapLanding={handleWorkMinimapLanding}
                      />
                    </div>
                  </>
                )}
                {!isMobile && (
                  <TurnRoutingContext.Provider value={threadRoutingMode}>
                    <InlineThreadsOverlay
                      key={repliesSessionId}
                      messagesRef={messagesRef}
                      unsent={inlineRepliesUnsent}
                      sentThreads={sentInlineThreads}
                      resolveSignal={turns.length}
                      maxHeight={composerMaxHeight}
                      onEditReply={editInlineReply}
                      onRemove={removeInlineReply}
                      threadSessions={{
                        threads: inlineThreads,
                        onSubmit: handleSubmitInlineThread,
                        onInterrupt: interruptInlineThread,
                        onPromote: handlePromoteThread,
                        onPromoteToRail: handlePromoteThreadToRail,
                        onFocusRailPromoted: handleFocusRailPromoted,
                        workspaceId,
                      }}
                      composer={overlayComposer}
                      sessionId={repliesSessionId}
                    />
                  </TurnRoutingContext.Provider>
                )}
                <QuoteAffordance
                  messagesRef={messagesRef}
                  enabled={!(isMobile || showReplayOverlay)}
                  onQuote={handleQuote}
                  showingRef={quoteShowingRef}
                />
              </>
            )}
          </ErrorBoundary>
        </FocusedMarksContext.Provider>
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
