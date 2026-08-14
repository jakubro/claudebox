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
import { REPLAY_DRAIN_SLICE_SIZE } from '../config/thresholds'
import {
  NORMAL_BATCH_INTERVAL,
  RECONNECT_MAX_ATTEMPTS,
  REPLAY_DRAIN_INTERVAL_MS,
} from '../config/timing'
import useSSE from '../hooks/useSSE'
import { StreamingStatusContext } from './StreamingStatusContext'
import { eventsReducer, initialState } from './utils/eventsReducer'
import { replaySliceEnd } from './utils/replaySlice'

const EventsContext = createContext(null)

/**
 * High-frequency context - events update during streaming.
 * Consumers that only need connection status should use the useConnectionStatus() hook.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function EventsProvider({ children }) {
  const [state, dispatch] = useReducer(eventsReducer, initialState)

  // Streaming buffer drains into the reducer via one FLUSH_BATCH dispatch every NORMAL_BATCH_INTERVAL ms.
  const eventBufferRef = useRef([])
  const batchTimeoutRef = useRef(null)
  const isReplayingRef = useRef(false) // Sync ref for event handler

  // Replay buffer: drained in bounded slices so history materializes progressively, not in one blocking commit.
  // Live events during the drain join this same queue, not the streaming path, so a newer event can't jump ahead.
  const replayBufferRef = useRef([])
  const replayTimeoutRef = useRef(null)
  const replayServerDoneRef = useRef(false)

  const drainReplaySlice = useCallback(() => {
    replayTimeoutRef.current = null

    const take = replaySliceEnd(
      replayBufferRef.current,
      REPLAY_DRAIN_SLICE_SIZE,
      replayServerDoneRef.current,
    )
    if (take > 0) {
      const batchEvents = replayBufferRef.current.slice(0, take)
      replayBufferRef.current = replayBufferRef.current.slice(take)
      dispatch({ type: 'REPLAY_SLICE', batchEvents })
    }

    if (replayBufferRef.current.length > 0 || !replayServerDoneRef.current) {
      replayTimeoutRef.current = setTimeout(drainReplaySlice, REPLAY_DRAIN_INTERVAL_MS)
      return
    }

    isReplayingRef.current = false
    dispatch({ type: 'REPLAY_ENDED' })
  }, [])

  const scheduleReplayDrain = useCallback(() => {
    if (!replayTimeoutRef.current) {
      replayTimeoutRef.current = setTimeout(drainReplaySlice, REPLAY_DRAIN_INTERVAL_MS)
    }
  }, [drainReplaySlice])

  // SSE message handler - parses events, manages replay boundaries, batches updates
  const onMessage = useCallback(
    e => {
      try {
        const event = JSON.parse(e.data)
        event.timestamp = Date.now()

        // flushSync ensures the "Resuming" UI paints before replay events are processed
        if (event.type === EventType.SYSTEM && event.subtype === EventSubtype.REPLAY_STARTED) {
          isReplayingRef.current = true
          replayServerDoneRef.current = false
          replayBufferRef.current = []
          flushSync(() => {
            dispatch({ type: 'REPLAY_STARTED', count: event.count ?? 0 })
          })
          return
        }

        if (event.type === EventType.SYSTEM && event.subtype === EventSubtype.REPLAY_ENDED) {
          // Server is done sending, but buffered events remain; isReplaying clears once the buffer drains.
          replayServerDoneRef.current = true
          // Leftover streaming events join the tail of the replay queue instead of jumping ahead of it.
          if (eventBufferRef.current.length > 0) {
            replayBufferRef.current.push(...eventBufferRef.current)
            eventBufferRef.current = []
          }
          if (replayTimeoutRef.current) {
            clearTimeout(replayTimeoutRef.current)
            replayTimeoutRef.current = null
          }
          drainReplaySlice()
          return
        }

        // Replay path: buffer into the ordered queue; the drain materializes it in slices.
        if (isReplayingRef.current) {
          replayBufferRef.current.push(event)
          scheduleReplayDrain()
          return
        }

        // STREAMING_FLAGS dispatches synchronously so status UI doesn't lag the stream.
        // Heavier derived state still batches into the reducer via FLUSH_BATCH every NORMAL_BATCH_INTERVAL ms.
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
    },
    [drainReplaySlice, scheduleReplayDrain],
  )

  // Container ID is mirrored into React state so sseUrl reacts to changes.
  // Callers must call notifyContainerChanged() after setContainerId() to trigger a re-render.
  const [containerId, setContainerIdState] = useState(() => getContainerId())

  // Sync React state with the module-level containerId
  const notifyContainerChanged = useCallback(() => {
    setContainerIdState(getContainerId())
  }, [])

  // Compute SSE URL - null when no container (SSE stays disconnected)
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

  // Signal container SSE reconnection exhausted - consumed by ContainerRecoveryEffect
  const [containerRecoveryNeeded, setContainerRecoveryNeeded] = useState(0)
  const handleReconnectExhausted = useCallback(() => {
    setContainerRecoveryNeeded(n => n + 1)
  }, [])

  // SSE connection lifecycle - delegated to SSEConnectionManager via useSSE
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

  const isConnected = connectionStatus === ConnectionStatus.CONNECTED

  const startResume = useCallback(() => {
    dispatch({ type: 'RESUME_STARTED' })
  }, [])

  const clearResume = useCallback(() => {
    dispatch({ type: 'RESUME_CLEARED' })
  }, [])

  const startCreating = useCallback(() => {
    dispatch({ type: 'CREATING_STARTED' })
  }, [])

  const clearCreating = useCallback(() => {
    dispatch({ type: 'CREATING_ENDED' })
  }, [])

  const startForking = useCallback(() => {
    dispatch({ type: 'FORKING_STARTED' })
  }, [])

  const clearForking = useCallback(() => {
    dispatch({ type: 'FORKING_ENDED' })
  }, [])

  const startOpeningBoard = useCallback(() => {
    dispatch({ type: 'OPENING_BOARD_STARTED' })
  }, [])

  const clearOpeningBoard = useCallback(() => {
    dispatch({ type: 'OPENING_BOARD_ENDED' })
  }, [])

  const startOpeningWorkspace = useCallback(() => {
    dispatch({ type: 'OPENING_WORKSPACE_STARTED' })
  }, [])

  const clearOpeningWorkspace = useCallback(() => {
    dispatch({ type: 'OPENING_WORKSPACE_ENDED' })
  }, [])

  // Without this, an in-flight replay slice or streaming flush could re-populate a chat that was just cleared.
  const resetEventBuffers = useCallback(() => {
    isReplayingRef.current = false
    replayServerDoneRef.current = false
    replayBufferRef.current = []
    eventBufferRef.current = []
    if (replayTimeoutRef.current) {
      clearTimeout(replayTimeoutRef.current)
      replayTimeoutRef.current = null
    }
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current)
      batchTimeoutRef.current = null
    }
  }, [])

  // Graceful disconnect - clears events without scheduling reconnect
  const disconnectSSE = useCallback(() => {
    dispatch({ type: 'CLEAR_EVENTS' })
    resetEventBuffers()
    rawDisconnect()
  }, [rawDisconnect, resetEventBuffers])

  // Reconnects SSE and clears events, unless skipClear=true (new sessions have no stale events).
  const reconnectSSE = useCallback(
    ({ skipClear = false } = {}) => {
      if (!skipClear) {
        dispatch({ type: 'CLEAR_EVENTS' })
      }
      resetEventBuffers()
      rawReconnect()
    },
    [rawReconnect, resetEventBuffers],
  )

  // Permanent close - clears events, kills connection with no reconnect possible
  const closeSSE = useCallback(() => {
    dispatch({ type: 'CLEAR_EVENTS' })
    resetEventBuffers()
    // Synchronously close the manager to kill any pending reconnect timers
    rawClose()
    // Null the container state so sseUrl becomes null
    setContainerId(null)
    setContainerIdState(null)
  }, [rawClose, resetEventBuffers])

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
      replayProgress: state.replayDrained,
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
      state.replayDrained,
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

  // Stable-identity flags for consumers that only watch resume/replay/respond transitions (e.g. SessionsPanel).
  // Isolates them from EventsContext's FLUSH_BATCH-cadence churn; re-renders only when one flag flips.
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
