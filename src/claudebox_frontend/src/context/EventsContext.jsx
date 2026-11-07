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
import {
  getAddressedSessionId,
  getContainerId,
  getWorkspaceId,
  sessionPath,
  setAddress,
} from '../api/apiClient'
import { ConnectionStatus, EventSubtype, EventType } from '../config/schema'
import { REPLAY_DRAIN_SLICE_SIZE } from '../config/thresholds'
import { NORMAL_BATCH_INTERVAL, RECONNECT_MAX_ATTEMPTS } from '../config/timing'
import useSSE from '../hooks/useSSE'
import { isDoneRespondingEvent } from '../utils/eventPredicates'
import { StreamingStatusContext } from './StreamingStatusContext'
import { eventsReducer, initialState, nextCreations } from './utils/eventsReducer'
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
  const replayScheduledRef = useRef(false)
  const replayServerDoneRef = useRef(false)
  const replayPortRef = useRef(null)
  const drainReplaySliceRef = useRef(null)

  // A hidden tab clamps setTimeout to about one call a second, which is what stretches an
  // unfocused replay into minutes. MessagePort delivery carries no such clamp.
  const scheduleReplayDrain = useCallback(() => {
    if (replayScheduledRef.current) {
      return
    }

    if (!replayPortRef.current) {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => drainReplaySliceRef.current()
      replayPortRef.current = channel.port2
    }

    replayScheduledRef.current = true
    replayPortRef.current.postMessage(null)
  }, [])

  const drainReplaySlice = useCallback(() => {
    replayScheduledRef.current = false

    const take = replaySliceEnd(
      replayBufferRef.current,
      REPLAY_DRAIN_SLICE_SIZE,
      replayServerDoneRef.current,
    )

    // Zero against a non-empty queue means replaySliceEnd is holding an unclosed compaction run
    // back, which only happens before the server finishes. Idle rather than spin.
    if (take === 0 && replayBufferRef.current.length > 0) {
      return
    }

    if (take > 0) {
      const batchEvents = replayBufferRef.current.slice(0, take)
      replayBufferRef.current = replayBufferRef.current.slice(take)
      dispatch({ type: 'REPLAY_SLICE', batchEvents })
    }

    if (replayBufferRef.current.length > 0) {
      scheduleReplayDrain()
      return
    }

    // Drained ahead of the server: idle, since the next arriving event schedules another slice.
    if (!replayServerDoneRef.current) {
      return
    }

    isReplayingRef.current = false
    dispatch({ type: 'REPLAY_ENDED' })
  }, [scheduleReplayDrain])

  drainReplaySliceRef.current = drainReplaySlice

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
          scheduleReplayDrain()
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
        // A turn's end flushes at once: whatever reads it - done signals, waiting on background
        // work - must see the turn's own events alongside it, not 50 ms later.
        if (isDoneRespondingEvent(event)) {
          clearTimeout(batchTimeoutRef.current)
          batchTimeoutRef.current = null
          const batchEvents = eventBufferRef.current
          eventBufferRef.current = []
          dispatch({ type: 'FLUSH_BATCH', batchEvents })
          return
        }
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
    [scheduleReplayDrain],
  )

  // The addressed session is mirrored into React state so sseUrl reacts to changes.
  // Callers must call notifyAddressChanged() after setAddress() to trigger a re-render.
  const [address, setAddressState] = useState(readAddress)
  const { containerId, sessionId: addressedSessionId } = address

  const notifyAddressChanged = useCallback(() => {
    setAddressState(readAddress())
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
    return `/api/workspaces/${wsId}/containers/${containerId}${sessionPath('/api/stream', addressedSessionId)}`
  }, [containerId, addressedSessionId])

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
    openKeyed,
    closeKeyed,
  } = useSSE({
    onMessage,
    url: sseUrl,
    maxAttempts: RECONNECT_MAX_ATTEMPTS,
    onReconnectExhausted: handleReconnectExhausted,
  })

  // Open a second, independent stream for a session other than the active one; its events reach
  // only the caller's callback, and a miss returns 503 rather than the container's primary.
  const subscribeSession = useCallback(
    (sessionId, sessionContainerId, onSessionMessage, { replay = true, onError } = {}) => {
      const wsId = getWorkspaceId()
      if (!(wsId && sessionContainerId)) {
        return () => {}
      }
      const params = new URLSearchParams({ session_id: sessionId })
      // replay=false: a float re-attaching to an already-running side thread, which read the
      // persisted log via the events route first and wants only what arrives from here on.
      if (!replay) {
        params.set('replay', 'false')
      }
      const url = `/api/workspaces/${wsId}/containers/${sessionContainerId}/api/stream?${params}`
      return openKeyed(sessionId, url, {
        onMessage: onSessionMessage,
        maxAttempts: RECONNECT_MAX_ATTEMPTS,
        onStatusChange: status => {
          if (status === 'error') {
            onError?.()
          }
        },
      })
    },
    [openKeyed],
  )

  const unsubscribeSession = useCallback(
    sessionId => {
      closeKeyed(sessionId)
    },
    [closeKeyed],
  )

  const isConnected = connectionStatus === ConnectionStatus.CONNECTED

  // Ref mirrors of the request markers and creation record, for event-time reads.
  const requestsRef = useRef({ resume: null, create: null })
  const creationsRef = useRef(initialState.creations)
  const resumeTokenRef = useRef(0)

  const dispatchCreation = useCallback(action => {
    creationsRef.current = nextCreations(creationsRef.current, action)
    dispatch(action)
  }, [])

  // Open and create lifetimes: a start returns the id its caller settles or aborts with; clearCreating
  // is a soft end a pending create ignores.
  const requestActions = useMemo(() => {
    const settle = (kind, id) => {
      if (requestsRef.current[kind] === id) {
        requestsRef.current[kind] = null
      }
    }

    return {
      startResume: () => {
        const token = ++resumeTokenRef.current
        requestsRef.current.resume = token
        dispatch({ type: 'RESUME_STARTED', token })
        return token
      },
      settleResumeRequest: token => {
        settle('resume', token)
        dispatch({ type: 'RESUME_REQUEST_SETTLED', token })
      },
      clearResume: () => {
        requestsRef.current.resume = null
        dispatch({ type: 'RESUME_CLEARED' })
      },
      startCreating: (fromRoute = null, carriedMessages = []) => {
        const seq = creationsRef.current.current + 1
        requestsRef.current.create = seq
        dispatchCreation({ type: 'CREATING_STARTED', seq, fromRoute, carried: carriedMessages })
        return seq
      },
      settleCreateRequest: (seq, sessionId, answer = {}) => {
        settle('create', seq)
        dispatchCreation({ type: 'CREATE_REQUEST_SETTLED', seq, sessionId, answer })
      },
      failCreating: seq => {
        settle('create', seq)
        dispatchCreation({ type: 'CREATING_FAILED', seq })
      },
      placeOpening: (seq, field) => dispatchCreation({ type: 'OPENING_PLACED', seq, field }),
      clearCreating: () => dispatch({ type: 'CREATING_ENDED' }),
      getCreation: () => creationsRef.current,
      getPendingRequests: () => ({ ...requestsRef.current }),
    }
  }, [dispatchCreation])

  // Marks a session id as "just created by this tab" - isCreating's clearing races the URL update,
  // so a resume-skip check reading it at effect time can already see false. Consumed on first read.
  const justCreatedSessionIdRef = useRef(null)

  const markJustCreatedSession = useCallback(sessionId => {
    justCreatedSessionIdRef.current = sessionId
  }, [])

  // Consuming it also marks the creation routed: the route has reached the session it produced.
  const consumeJustCreatedSession = useCallback(
    sessionId => {
      if (justCreatedSessionIdRef.current !== sessionId) {
        return false
      }
      justCreatedSessionIdRef.current = null
      const { current, bySeq } = creationsRef.current
      if (bySeq[current]?.sessionId === sessionId) {
        dispatchCreation({ type: 'CREATION_ROUTED', seq: current })
      }
      return true
    },
    [dispatchCreation],
  )

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
    // An already-posted port message still lands, finds an empty queue, and dispatches nothing.
    replayScheduledRef.current = false
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

  // Reconnects SSE; the new connection's own replay replaces the transcript once it lands.
  const reconnectSSE = useCallback(() => {
    dispatch({ type: 'REPLAY_ABANDONED' })
    resetEventBuffers()
    rawReconnect()
  }, [rawReconnect, resetEventBuffers])

  // Permanent close - clears events, kills connection with no reconnect possible
  const closeSSE = useCallback(() => {
    dispatch({ type: 'CLEAR_EVENTS' })
    resetEventBuffers()
    // Synchronously close the manager to kill any pending reconnect timers
    rawClose()
    // Null the container state so sseUrl becomes null
    setAddress(null, null)
    setAddressState(readAddress())
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
      backgroundLaunches: state.backgroundLaunches,
      runningBackgroundWork: state.runningBackgroundWork,
      awaitingPickup: !state.isResponding && state.hasUnclaimedCompletion,
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
      isResumeRequestPending: state.resumeRequest !== null,
      isCreating: state.isCreating,
      isCreateRequestPending: state.createRequest !== null,
      creations: state.creations,
      createdSessionId: createdSessionIdOf(state.creations),
      isForking: state.isForking,
      isOpeningBoard: state.isOpeningBoard,
      isOpeningWorkspace: state.isOpeningWorkspace,
      isReplaying: state.isReplaying,
      replayTotal: state.replayTotal,
      replayProgress: state.replayDrained,
      reconnectSSE,
      disconnectSSE,
      closeSSE,
      ...requestActions,
      markJustCreatedSession,
      consumeJustCreatedSession,
      startForking,
      clearForking,
      startOpeningBoard,
      clearOpeningBoard,
      startOpeningWorkspace,
      clearOpeningWorkspace,
      containerId,
      notifyAddressChanged,
      containerRecoveryNeeded,
      subscribeSession,
      unsubscribeSession,
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
      state.backgroundLaunches,
      state.runningBackgroundWork,
      state.hasUnclaimedCompletion,
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
      state.resumeRequest,
      state.isCreating,
      state.createRequest,
      state.creations,
      state.isForking,
      state.isOpeningBoard,
      state.isOpeningWorkspace,
      state.isReplaying,
      state.replayTotal,
      state.replayDrained,
      reconnectSSE,
      disconnectSSE,
      closeSSE,
      requestActions,
      markJustCreatedSession,
      consumeJustCreatedSession,
      startForking,
      clearForking,
      startOpeningBoard,
      clearOpeningBoard,
      startOpeningWorkspace,
      clearOpeningWorkspace,
      containerId,
      notifyAddressChanged,
      containerRecoveryNeeded,
      subscribeSession,
      unsubscribeSession,
    ],
  )

  // Stable-identity flags for consumers that only watch resume/replay/respond transitions and the
  // request lifetimes (e.g. SessionsPanel, useSessionOwnership), isolated from flush-rate churn.
  const streamingStatus = useMemo(
    () => ({
      isResuming: state.isResuming,
      isReplaying: state.isReplaying,
      isResponding: state.isResponding,
      isResumeRequestPending: state.resumeRequest !== null,
      isCreateRequestPending: state.createRequest !== null,
      creations: state.creations,
      getCreation: requestActions.getCreation,
    }),
    [
      state.isResuming,
      state.isReplaying,
      state.isResponding,
      state.resumeRequest,
      state.createRequest,
      state.creations,
      requestActions,
    ],
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

/** The current creation's session once it is created, else null. */
function createdSessionIdOf({ current, bySeq }) {
  const entry = bySeq[current]
  return entry && (entry.status === 'created' || entry.status === 'routed') ? entry.sessionId : null
}

function readAddress() {
  return { containerId: getContainerId(), sessionId: getAddressedSessionId() }
}
