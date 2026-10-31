/** Hook wrapper for ChatController class. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionActions, useSessionData } from '../../../context/SessionDataContext'
import { useStreamingStatus } from '../../../context/StreamingStatusContext'
import useSessionOwnership from '../../../hooks/useSessionOwnership'
import { isOrphanedTag, resolveOwnerTag } from '../../../utils/sessionOwnership'
import ChatController from '../ChatController'
import { heldCreations, joinReturned } from '../utils/creationInput'
import { readPreservedInput } from '../utils/preservedInput'
import useMessageQueue from './useMessageQueue'
import usePendingMessages from './usePendingMessages'
import useSendMessage from './useSendMessage'

/** Coordinate chat panel hooks with ChatController for scroll, pending, queue, and send. */
export default function useChatController({ events, contextRefs, activeTurnId = null }) {
  // DOM refs - owned by this hook
  const messagesRef = useRef(null)
  const panelRef = useRef(null)
  const activeTurnIdRef = useRef(activeTurnId)
  activeTurnIdRef.current = activeTurnId

  const { sessionId, isApplyingPendingConfig } = useSessionData()
  const { reloadSession } = useSessionActions()
  const { ownerSessionId, isOwnerAttached, ownerNow, resolveOwner } = useSessionOwnership()
  const {
    resultCount,
    compactionCount,
    isCreating,
    isConnected,
    isReplaying,
    isResuming,
    containerId,
  } = useEvents()
  const { creations } = useStreamingStatus()
  const { interruptStatus, startSubmitting, submitSucceeded, submitFailed, setError } =
    useInteraction()

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

  // Spans the resume click through the last replayed turn materializing; isCreating is excluded
  // since a fresh session also replays empty boundaries, which would race the deferred first message.
  const isLoadingSession = isResuming || isReplaying

  // Pending messages with SSE reconciliation, against the owner's own events only
  const { showPendingMessages, addPendingMessage, removePendingMessage } = usePendingMessages(
    events,
    ownerSessionId,
    isOwnerAttached && !isLoadingSession,
  )

  // The raw send; the queue wraps it so a failed send pauses its own session's queue.
  const sendMessage = useSendMessage({
    addPendingMessage,
    removePendingMessage,
    startSubmitting,
    submitSucceeded,
    submitFailed,
    setError,
    onContainerGone: reloadSession,
    ownerNow,
  })

  // Message queue (drain, pause, lifecycle)
  const {
    queueItems,
    send,
    enqueueMessage,
    returnFailedMessage,
    editQueuedItem,
    cancelQueuedItem,
    requeueItem,
    sendNowItem,
    takeCreation,
    adoptCreation,
  } = useMessageQueue({
    resultCount,
    compactionCount,
    isLoading: isLoadingSession,
    interruptStatus,
    sessionId,
    containerId,
    sendFn: sendMessage,
  })

  // A message queued while a session is created is held for that creation.
  const enqueueOwned = useCallback(
    (content, attachments) => enqueueMessage(content, attachments, ownerNow()),
    [enqueueMessage, ownerNow],
  )

  // Holds the first message submitted during session creation, owned by that creation; it is sent
  // only into the session the creation produces, once that session is attached and connected.
  const [heldFirstMessage, setHeldFirstMessage] = useState(null)

  // Use ref to check current deferred state without stale closures
  const deferredSendRef = useRef(null)
  // The held message stays on screen until its send settles, so the effect must not send it twice.
  const heldInFlightRef = useRef(false)

  const deferSend = useCallback(
    (content, attachments) => {
      if (deferredSendRef.current) {
        // Already have a deferred message - route subsequent to queue
        enqueueOwned(content, attachments)
      } else {
        const msg = { content, attachments, owner: ownerNow() }
        deferredSendRef.current = msg
        setHeldFirstMessage(msg)
      }
    },
    [enqueueOwned, ownerNow],
  )

  // Shown while its creation is still unbound, or on its own session once bound.
  const heldFor = heldFirstMessage ? resolveOwner(heldFirstMessage.owner) : null
  const deferredSend =
    heldFirstMessage && (heldFor === null || heldFor === ownerSessionId) ? heldFirstMessage : null

  // isCreating cannot gate it - it clears only once the deferred message is already visible, a
  // cycle only the send itself can break. Targeted: opening another session moves the address first.
  useEffect(() => {
    if (!heldFirstMessage) {
      return
    }
    if (
      heldFor &&
      heldFor === sessionId &&
      isConnected &&
      !isApplyingPendingConfig &&
      !heldInFlightRef.current
    ) {
      const { content, attachments } = heldFirstMessage
      heldInFlightRef.current = true
      send(content, { attachments, target: { sessionId: heldFor, containerId } }).then(sent => {
        heldInFlightRef.current = false
        setHeldFirstMessage(null)
        deferredSendRef.current = null
        if (sent) {
          return
        }
        // A container-gone failure already has its own recovery path (composer restore once
        // reconnected) - queueing it too would risk sending the same message twice.
        if (readPreservedInput()?.content === content) {
          return
        }
        returnFailedMessage(heldFor, content, attachments)
      })
    }
  }, [
    isConnected,
    heldFirstMessage,
    heldFor,
    sessionId,
    containerId,
    isApplyingPendingConfig,
    send,
    returnFailedMessage,
  ])

  // Items held for a creation join the queue once the session it produced is attached.
  useEffect(() => {
    if (!sessionId) {
      return
    }
    for (const seq of heldCreations(queueItems)) {
      if (resolveOwnerTag({ creation: seq }, creations) === sessionId) {
        adoptCreation(seq)
      }
    }
  }, [sessionId, queueItems, creations, adoptCreation])

  // A failed creation hands back everything typed for it, in the order typed, for the composer.
  const [returnedInput, setReturnedInput] = useState(null)
  useEffect(() => {
    const failed = new Set(
      [heldFirstMessage?.owner, ...queueItems.map(i => i.owner)]
        .filter(tag => isOrphanedTag(tag, creations))
        .map(tag => tag.creation),
    )
    if (failed.size === 0) {
      return
    }

    const returned = []
    if (failed.has(heldFirstMessage?.owner?.creation)) {
      returned.push(heldFirstMessage)
      setHeldFirstMessage(null)
      deferredSendRef.current = null
    }
    for (const seq of failed) {
      returned.push(...takeCreation(seq))
    }
    setReturnedInput(prev => joinReturned(prev, returned))
  }, [heldFirstMessage, queueItems, creations, takeCreation])
  const clearReturnedInput = useCallback(() => setReturnedInput(null), [])

  // Reset autoscroll on session change - new session always starts at bottom, unless the URL names a
  // turn: that jump owns the position, and a session id settling after it would pull the view away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is needed
  useEffect(() => {
    if (activeTurnIdRef.current) {
      return
    }
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
      enqueueMessage: enqueueOwned,
      editQueuedItem,
      cancelQueuedItem,
      requeueItem,
      sendNowItem,
    },

    // Deferred send (first message during session creation)
    deferred: {
      deferredSend,
      deferSend,
      returnedInput,
      clearReturnedInput,
    },

    // Shared send callback
    send,
  }
}
