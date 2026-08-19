/** Hook wrapper for ChatController class. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionActions, useSessionData } from '../../../context/SessionDataContext'
import ChatController from '../ChatController'
import useMessageQueue from './useMessageQueue'
import usePendingMessages from './usePendingMessages'
import useSendMessage from './useSendMessage'

/** Coordinate chat panel hooks with ChatController for scroll, pending, queue, and send. */
export default function useChatController({ events, contextRefs }) {
  // DOM refs - owned by this hook
  const messagesRef = useRef(null)
  const panelRef = useRef(null)

  const { sessionId } = useSessionData()
  const { reloadSession } = useSessionActions()
  const { resultCount, compactionCount, isCreating, isConnected, isReplaying, isResuming } =
    useEvents()
  const {
    interruptStatus,
    startSubmitting,
    submitSucceeded,
    submitFailed,
    setError,
    errorMessage,
  } = useInteraction()

  // Drives aria-pressed bindings in ChatControlBar; synced from controller via onAutoScrollChange.
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)

  // Controller instance (stable across renders)
  const controllerRef = useRef(null)
  if (!controllerRef.current) {
    controllerRef.current = new ChatController({
      onAutoScrollChange: enabled => {
        if (contextRefs.chatPanelSwitchingRef?.current) {
          return
        }
        if (contextRefs.chatAutoScrollEnabledRef) {
          contextRefs.chatAutoScrollEnabledRef.current = enabled
        }
        setIsAutoScrollEnabled(enabled)
      },
      onScrollPositionChange: position => {
        if (contextRefs.chatPanelSwitchingRef?.current) {
          return
        }
        if (contextRefs.chatScrollPositionRef) {
          contextRefs.chatScrollPositionRef.current = position
        }
      },
    })
    // Exposed for repro/verify scripts reading isAutoScrollEnabled directly; DEV-gated out of prod.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__chat_controller__ = controllerRef.current
    }
  }
  const controller = controllerRef.current

  // Re-runs on sessionId/isCreating: covers the welcome->chat transition, where .chat-messages
  // mounts only after isWelcome flips false (messagesRef is null on the first welcome-state run).
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId/isCreating proxy the chat-messages mount transition
  useEffect(() => {
    if (!messagesRef.current) {
      return
    }
    controller.initialize({
      messagesEl: messagesRef.current,
      panelEl: panelRef.current,
    })

    // Sync autoscroll enabled state from context
    if (contextRefs.chatAutoScrollEnabledRef?.current !== undefined) {
      controller.isAutoScrollEnabled = contextRefs.chatAutoScrollEnabledRef.current
    }

    // Attach ResizeObserver for scroll preservation across layout changes
    controller.attachResizeObserver(messagesRef.current, contextRefs)

    // Passive wheel/touch/keydown listeners for user-intent detection; runs independently of
    // streaming-driven height changes.
    controller.attachInputListeners(messagesRef.current)

    return () => controller.dispose()
  }, [controller, contextRefs, sessionId, isCreating])

  // Pending messages with SSE reconciliation
  const { showPendingMessages, addPendingMessage, removePendingMessage } = usePendingMessages(
    events,
    sessionId,
  )

  // Shared send callback (used by queue drain, ChatInput submit, ChatPanel form submit)
  const send = useSendMessage({
    addPendingMessage,
    removePendingMessage,
    startSubmitting,
    submitSucceeded,
    submitFailed,
    setError,
    onContainerGone: reloadSession,
  })

  // Spans the resume click through the last replayed turn materializing; isCreating is excluded
  // since a fresh session also replays empty boundaries, which would race the deferred first message.
  const isLoadingSession = isResuming || isReplaying

  // Message queue (drain, pause, lifecycle)
  const { queueItems, enqueueMessage, editQueuedItem, cancelQueuedItem, requeueItem, sendNowItem } =
    useMessageQueue({
      resultCount,
      compactionCount,
      isLoading: isLoadingSession,
      interruptStatus,
      errorMessage,
      sessionId,
      sendFn: send,
    })

  // Holds the first message submitted during session creation; auto-fires send() once connected.
  const [deferredSend, setDeferredSend] = useState(null)

  // Use ref to check current deferred state without stale closures
  const deferredSendRef = useRef(null)

  const deferSend = useCallback(
    (content, attachments) => {
      if (deferredSendRef.current) {
        // Already have a deferred message - route subsequent to queue
        enqueueMessage(content, attachments)
      } else {
        const msg = { content, attachments }
        deferredSendRef.current = msg
        setDeferredSend(msg)
      }
    },
    [enqueueMessage],
  )

  // Fires once sessionId and the container connection are both available; preserves deferredSend
  // through the null->realId sessionId transition. isCreating cannot gate it - it clears only once
  // the deferred message is already visible, a cycle only the send itself can break.
  useEffect(() => {
    if (!deferredSend) {
      return
    }
    if (sessionId && isConnected) {
      send(deferredSend.content, { attachments: deferredSend.attachments })
      setDeferredSend(null)
      deferredSendRef.current = null
    }
  }, [isConnected, deferredSend, sessionId, send])

  // Clears deferred send on an actual session switch (old and new both non-null), but not during
  // creation - the provisional->real ID transition must preserve it for auto-fire.
  const prevSessionIdForClearRef = useRef(sessionId)
  useEffect(() => {
    const prev = prevSessionIdForClearRef.current
    prevSessionIdForClearRef.current = sessionId
    if (prev && sessionId && prev !== sessionId) {
      setDeferredSend(null)
      deferredSendRef.current = null
    }
  }, [sessionId])

  // Reset autoscroll on session change - new session always starts at bottom
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is needed
  useEffect(() => {
    controller.isAutoScrollEnabled = true
    if (contextRefs.chatAutoScrollEnabledRef) {
      contextRefs.chatAutoScrollEnabledRef.current = true
    }
    setIsAutoScrollEnabled(true)
    controller.scrollToBottom()
  }, [sessionId, contextRefs.chatAutoScrollEnabledRef, controller])

  // Scroll handling - single authority via controller
  const handleScroll = useCallback(() => {
    controller.handleUserScroll()
  }, [controller])

  const scrollToBottom = useCallback(() => {
    controller.scrollToBottom()
  }, [controller])

  // Brackets external scroll writes (e.g. useMessageJump's scrollToEdge) so they're classified as
  // programmatic, not user intent.
  const markProgrammaticScroll = useCallback(() => {
    controller.markProgrammaticScroll()
  }, [controller])

  // For cross-panel callers (e.g. BookmarksPanel bookmark click landing not-at-bottom); mirrors the
  // direction-aware gate input listeners apply before reaching the controller.
  const markUserIntent = useCallback(() => {
    controller.markUserIntent()
  }, [controller])

  // For callers landing the viewport at the bottom (jumpBottom, jumpNext fall-through); clears
  // latched intent and re-engages autoscroll.
  const markReturnedToBottom = useCallback(() => {
    controller.markReturnedToBottom()
  }, [controller])

  // Coordinated event/pending/queue change handling
  useEffect(() => {
    controller.onEventsChange(events)
  }, [events, controller])

  useEffect(() => {
    controller.onPendingMessagesChange(showPendingMessages)
  }, [showPendingMessages, controller])

  useEffect(() => {
    controller.onQueueChange(queueItems)
  }, [queueItems, controller])

  return {
    // DOM refs
    refs: {
      messagesRef,
      panelRef,
    },

    // Scroll state and handlers
    scroll: {
      isAutoScrollEnabledRef: contextRefs.chatAutoScrollEnabledRef,
      isAutoScrollEnabled,
      handleScroll,
      scrollToBottom,
      markProgrammaticScroll,
      markUserIntent,
      markReturnedToBottom,
    },

    // Pending messages
    pending: {
      showPendingMessages,
      addPendingMessage,
      removePendingMessage,
    },

    // Message queue
    queue: {
      queueItems,
      enqueueMessage,
      editQueuedItem,
      cancelQueuedItem,
      requeueItem,
      sendNowItem,
    },

    // Deferred send (first message during session creation)
    deferred: {
      deferredSend,
      deferSend,
    },

    // Shared send callback
    send,
  }
}
