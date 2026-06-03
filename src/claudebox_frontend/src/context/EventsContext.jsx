/** SSE events and connection state with reducer-based batching. */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { getContainerId, getWorkspaceId, setContainerId } from '../api/apiClient'
import { ConnectionStatus, EventSubtype, EventType } from '../config/schema'
import { NORMAL_BATCH_INTERVAL, RECONNECT_MAX_ATTEMPTS } from '../config/timing'
import useSSE from '../hooks/useSSE'
import { StreamingStatusContext } from './StreamingStatusContext'
import { eventsReducer, initialState } from './utils/eventsReducer'

const EventsContext = createContext(null)

/**
 * Provide SSE events and connection state.
 *
 * This is a high-frequency context - events update during streaming.
 * Consumers that only need connection status should use useConnectionStatus() hook.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function EventsProvider({ children }) {
  const [state, dispatch] = useReducer(eventsReducer, initialState)

  // Streaming-path event buffer. Events accumulate here and are drained into
  // the reducer in one FLUSH_BATCH dispatch every NORMAL_BATCH_INTERVAL ms,
  // so per-event reconciliation no longer fires on every SSE message.
  const eventBufferRef = useRef([])
  const batchTimeoutRef = useRef(null)
  const isReplayingRef = useRef(false) // Sync ref for event handler

  // SSE message handler — parses events, manages replay boundaries, batches updates
  const onMessage = useCallback(e => {
    try {
      const event = JSON.parse(e.data)
      event.timestamp = Date.now()

      // Handle replay boundary events from server
      // Use flushSync to ensure "Resuming" UI shows before processing events
      if (event.type === EventType.SYSTEM && event.subtype === EventSubtype.REPLAY_STARTED) {
        isReplayingRef.current = true
        flushSync(() => {
          dispatch({ type: 'REPLAY_STARTED', count: event.count ?? 0 })
        })
        return
      }

      if (event.type === EventType.SYSTEM && event.subtype === EventSubtype.REPLAY_ENDED) {
        isReplayingRef.current = false
        // Any leftover streaming events in the ref get included via REPLAY_ENDED.
        if (eventBufferRef.current.length > 0) {
          const carry = eventBufferRef.current
          eventBufferRef.current = []
          dispatch({ type: 'FLUSH_BATCH', batchEvents: carry })
        }
        dispatch({ type: 'REPLAY_ENDED' }) // Flushes replay accumulator (state.pendingBatch)
        return
      }

      // Replay path: per-event reducer dispatch so replayProgress / status
      // flags tick synchronously. Single big flush happens at REPLAY_ENDED.
      if (isReplayingRef.current) {
        dispatch({ type: 'EVENT_RECEIVED', event })
        return
      }

      // Streaming path. Two-phase update per event:
      //   1. STREAMING_FLAGS — applies isResponding / respondingSince /
      //      compaction state synchronously, so the "Working" spinner and
      //      silence detector track the SDK stream without waiting for a
      //      flush.
      //   2. Buffer the event into eventBufferRef. The heavy derived state
      //      (events, turns, todoDiffs, …) drains into the reducer in one
      //      FLUSH_BATCH dispatch every NORMAL_BATCH_INTERVAL ms.
      dispatch({ type: 'STREAMING_FLAGS', event })
      eventBufferRef.current.push(event)
      if (!batchTimeoutRef.current) {
        batchTimeoutRef.current = setTimeout(() => {
          batchTimeoutRef.current = null
          const batchEvents = eventBufferRef.current
          eventBufferRef.current = []
          dispatch({ type: 'FLUSH_BATCH', batchEvents })
        }, NORMAL_BATCH_INTERVAL)
      }
    } catch (err) {
      console.warn('EventsContext: Failed to parse SSE event', err)
    }
  }, [])

  // Track container ID as React state so SSE URL reacts to container changes.
  // Callers must call notifyContainerChanged() after setContainerId() to trigger re-render.
  const [containerId, setContainerIdState] = useState(() => getContainerId())

  // Sync React state with the module-level containerId
  const notifyContainerChanged = useCallback(() => {
    setContainerIdState(getContainerId())
  }, [])

  // Compute SSE URL — null when no container (SSE stays disconnected)
  const sseUrl = useMemo(() => {
    if (!containerId) {
      return null
    }
    const wsId = getWorkspaceId()
    if (!wsId) {
      return null
    }
    return `/api/workspaces/${wsId}/containers/${containerId}/api/stream`
  }, [containerId])

  // Signal container SSE reconnection exhausted — consumed by ContainerRecoveryEffect
  const [containerRecoveryNeeded, setContainerRecoveryNeeded] = useState(0)
  const handleReconnectExhausted = useCallback(() => {
    setContainerRecoveryNeeded(n => n + 1)
  }, [])

  // SSE connection lifecycle — delegated to SSEConnectionManager via useSSE
  const {
    connectionStatus,
    connectionError,
    reconnectSSE: rawReconnect,
    disconnectSSE: rawDisconnect,
    closeSSE: rawClose,
  } = useSSE({
    onMessage,
    url: sseUrl,
    maxAttempts: RECONNECT_MAX_ATTEMPTS,
    onReconnectExhausted: handleReconnectExhausted,
  })

  // Derived state
  const isConnected = connectionStatus === ConnectionStatus.CONNECTED

  // Signal that a session resume has started (before API call)
  const startResume = useCallback(() => {
    dispatch({ type: 'RESUME_STARTED' })
  }, [])

  // Clear resume state (on error before reconnect happens)
  const clearResume = useCallback(() => {
    dispatch({ type: 'RESUME_CLEARED' })
  }, [])

  // Signal that a new session creation has started
  const startCreating = useCallback(() => {
    dispatch({ type: 'CREATING_STARTED' })
  }, [])

  // Clear creating state (on success or error)
  const clearCreating = useCallback(() => {
    dispatch({ type: 'CREATING_ENDED' })
  }, [])

  // Signal that a fork operation has started
  const startForking = useCallback(() => {
    dispatch({ type: 'FORKING_STARTED' })
  }, [])

  // Clear forking state (on success or error)
  const clearForking = useCallback(() => {
    dispatch({ type: 'FORKING_ENDED' })
  }, [])

  // Signal that a board open transition has started
  const startOpeningBoard = useCallback(() => {
    dispatch({ type: 'OPENING_BOARD_STARTED' })
  }, [])

  const clearOpeningBoard = useCallback(() => {
    dispatch({ type: 'OPENING_BOARD_ENDED' })
  }, [])

  // Signal that a workspace new-tab open has started
  const startOpeningWorkspace = useCallback(() => {
    dispatch({ type: 'OPENING_WORKSPACE_STARTED' })
  }, [])

  const clearOpeningWorkspace = useCallback(() => {
    dispatch({ type: 'OPENING_WORKSPACE_ENDED' })
  }, [])

  // Graceful disconnect - clears events without scheduling reconnect
  const disconnectSSE = useCallback(() => {
    dispatch({ type: 'CLEAR_EVENTS' })
    isReplayingRef.current = false
    eventBufferRef.current = []
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current)
      batchTimeoutRef.current = null
    }
    rawDisconnect()
  }, [rawDisconnect])

  // Reconnect SSE - clears events and re-establishes connection.
  // skipClear: true skips CLEAR_EVENTS dispatch (used for new sessions with no stale events).
  const reconnectSSE = useCallback(
    ({ skipClear = false } = {}) => {
      if (!skipClear) {
        dispatch({ type: 'CLEAR_EVENTS' })
      }
      isReplayingRef.current = false
      eventBufferRef.current = []
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
        batchTimeoutRef.current = null
      }
      rawReconnect()
    },
    [rawReconnect],
  )

  // Permanent close — clears events, kills connection with no reconnect possible
  const closeSSE = useCallback(() => {
    dispatch({ type: 'CLEAR_EVENTS' })
    isReplayingRef.current = false
    eventBufferRef.current = []
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current)
      batchTimeoutRef.current = null
    }
    // Synchronously close the manager to kill any pending reconnect timers
    rawClose()
    // Null the container state so sseUrl becomes null
    setContainerId(null)
    setContainerIdState(null)
  }, [rawClose])

  const value = useMemo(
    () => ({
      events: state.events,
      visibleEvents: state.visibleEvents,
      turns: state.turns,
      turnResults: state.turnResults,
      taskNotifications: state.taskNotifications,
      todoDiffs: state.todoDiffs,
      todosBySubagent: state.todosBySubagent,
      subagentLabels: state.subagentLabels,
      connectionStatus,
      connectionError,
      isConnected,
      isResponding: state.isResponding,
      resultCount: state.resultCount,
      compactionCount: state.compactionCount,
      isCompacting: state.isCompacting,
      respondingSince: state.respondingSince,
      lastEventTimestamp: state.lastEventTimestamp,
      isResuming: state.isResuming,
      isCreating: state.isCreating,
      isForking: state.isForking,
      isOpeningBoard: state.isOpeningBoard,
      isOpeningWorkspace: state.isOpeningWorkspace,
      isReplaying: state.isReplaying,
      replayTotal: state.replayTotal,
      replayProgress: state.pendingBatch.length,
      reconnectSSE,
      disconnectSSE,
      closeSSE,
      startResume,
      clearResume,
      startCreating,
      clearCreating,
      startForking,
      clearForking,
      startOpeningBoard,
      clearOpeningBoard,
      startOpeningWorkspace,
      clearOpeningWorkspace,
      containerId,
      notifyContainerChanged,
      containerRecoveryNeeded,
    }),
    [
      state.events,
      state.visibleEvents,
      state.turns,
      state.turnResults,
      state.taskNotifications,
      state.todoDiffs,
      state.todosBySubagent,
      state.subagentLabels,
      connectionStatus,
      connectionError,
      isConnected,
      state.isResponding,
      state.resultCount,
      state.compactionCount,
      state.isCompacting,
      state.respondingSince,
      state.lastEventTimestamp,
      state.isResuming,
      state.isCreating,
      state.isForking,
      state.isOpeningBoard,
      state.isOpeningWorkspace,
      state.isReplaying,
      state.replayTotal,
      state.pendingBatch.length,
      reconnectSSE,
      disconnectSSE,
      closeSSE,
      startResume,
      clearResume,
      startCreating,
      clearCreating,
      startForking,
      clearForking,
      startOpeningBoard,
      clearOpeningBoard,
      startOpeningWorkspace,
      clearOpeningWorkspace,
      containerId,
      notifyContainerChanged,
      containerRecoveryNeeded,
    ],
  )

  // Stable-identity flags for consumers that only watch resume/replay/respond
  // transitions (e.g. SessionsPanel). The full EventsContext value churns at
  // FLUSH_BATCH cadence; this nested context changes only when one of the
  // three booleans flips, sparing peripheral subtrees from streaming-rate
  // re-renders.
  const streamingStatus = useMemo(
    () => ({
      isResuming: state.isResuming,
      isReplaying: state.isReplaying,
      isResponding: state.isResponding,
    }),
    [state.isResuming, state.isReplaying, state.isResponding],
  )

  return (
    <EventsContext.Provider value={value}>
      <StreamingStatusContext.Provider value={streamingStatus}>
        {children}
      </StreamingStatusContext.Provider>
    </EventsContext.Provider>
  )
}

/** Access SSE events and connection state. */
export function useEvents() {
  const context = useContext(EventsContext)
  if (!context) {
    throw new Error('useEvents must be used within EventsProvider')
  }
  return context
}
