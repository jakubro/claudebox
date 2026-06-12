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
  const { resultCount, compactionCount, isCreating } = useEvents()
  const {
    interruptStatus,
    startSubmitting,
    submitSucceeded,
    submitFailed,
    setError,
    errorMessage,
  } = useInteraction()

  // Reactive autoscroll-enabled state - drives aria-pressed bindings in
  // ChatControlBar. Synced from controller via onAutoScrollChange callback.
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
    // Dev-only test hook - exposes the controller to repro/verify scripts that
    // need to read isAutoScrollEnabled directly. Intentionally guarded by
    // import.meta.env.DEV so production bundles never expose it.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__chat_controller__ = controllerRef.current
    }
  }
  const controller = controllerRef.current

  // Initialize controller with DOM elements and ResizeObserver. Re-runs when
  // sessionId or isCreating changes - covers the welcome->chat transition where
  // .chat-messages mounts only after isWelcome flips to false (so messagesRef
  // is null on first effect run during welcome state).
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

    // Attach passive input listeners (wheel/touch/keydown) for user-intent
    // detection. Intent-driven autoscroll disengage runs independently of
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

  // Message queue (drain, pause, lifecycle)
  const { queueItems, enqueueMessage, editQueuedItem, cancelQueuedItem, requeueItem, sendNowItem } =
    useMessageQueue({
      resultCount,
      compactionCount,
      interruptStatus,
      errorMessage,
      sessionId,
      sendFn: send,
    })

  // Deferred send - holds the first message submitted during session creation.
  // Auto-fires send() when isCreating clears (session ready).
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

  // Auto-send deferred message when BOTH conditions are met:
  // 1. isCreating has cleared (session init complete)
  // 2. sessionId is available (can send)
  // Preserves deferredSend through the null->realId sessionId transition.
  const prevIsCreatingRef = useRef(isCreating)
  useEffect(() => {
    prevIsCreatingRef.current = isCreating
    if (!deferredSend) {
      return
    }
    if (!isCreating && sessionId) {
      send(deferredSend.content, deferredSend.attachments)
      setDeferredSend(null)
      deferredSendRef.current = null
    }
  }, [isCreating, deferredSend, sessionId, send])

  // Clear deferred send on actual session switch (both old and new non-null),
  // but not during creation - the provisional->real ID transition must preserve
  // the deferred message for auto-fire.
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

  // Bracket external scroll writes (e.g. useMessageJump's scrollToEdge) so
  // they are classified as programmatic and don't raise user intent.
  const markProgrammaticScroll = useCallback(() => {
    controller.markProgrammaticScroll()
  }, [controller])

  // Raise user intent from cross-panel callers (e.g. BookmarksPanel bookmark
  // click that lands the viewport not-at-bottom). Mirrors the direction-aware
  // gate that input listeners apply before reaching the controller.
  const markUserIntent = useCallback(() => {
    controller.markUserIntent()
  }, [controller])

  // Symmetric helper for callers that land the viewport at the bottom
  // (jumpBottom, jumpNext fall-through, future bookmark click that resolves
  // at-bottom). Clears latched intent and re-engages autoscroll.
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
