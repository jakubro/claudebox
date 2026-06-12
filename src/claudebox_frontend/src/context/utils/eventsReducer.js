/** Pure events reducer + initial state - extracted from EventsContext.jsx, no React APIs. */

import { EventSubtype } from '../../config/schema'
import { isDoneRespondingEvent, isHumanEvent, isRespondingEvent } from '../../utils/eventPredicates'
import {
  appendSubagentLabels,
  appendTaskDiffs,
  appendTaskNotifications,
  appendTodoDiffs,
  appendTurnResults,
  appendTurns,
  INITIAL_TURN_GROUPING_STATE,
  isVisibleEvent,
} from '../../utils/eventProcessing'

export const initialState = {
  events: [],
  pendingBatch: [], // Replay-only accumulator; streaming path buffers in a provider-level ref.
  isResponding: false, // Tracked incrementally: true on assistant, false on result
  resultCount: 0, // Increments on each response cycle completion (isResponding true->false)
  compactionCount: 0, // Increments on compact_boundary events (triggers queue drain)
  isCompacting: false, // True between compact_start and compact_boundary
  isResuming: false, // True from resume click until replay completes
  isReplaying: false, // True between replay_started and replay_ended
  replayTotal: 0, // Total events to replay (for progress indicator)
  lastEventTimestamp: null, // Updated on every flush (streaming) / per event (replay) for silence detection
  respondingSince: null, // Timestamp when current response started (isResponding flipped true)
  isCreating: false, // True while new session creation is in flight
  isForking: false, // True while a fork is in flight
  isOpeningBoard: false, // True while a board open transition paints
  isOpeningWorkspace: false, // True while a workspace new-tab open paints
  // Derived state - maintained incrementally in FLUSH_BATCH
  visibleEvents: [],
  turns: [],
  turnResults: {},
  taskNotifications: new Map(),
  todoDiffs: new Map(),
  todosBySubagent: new Map(),
  subagentLabels: new Map(),
  // Internal grouping state (not exposed to consumers)
  _turnGroupingState: INITIAL_TURN_GROUPING_STATE,
  _previousTodosBySubagent: new Map(),
  _asyncTaskIdMap: new Map(),
  // TaskCreate/TaskUpdate - mutually exclusive at the session level with
  // TodoWrite; both pipelines coexist additively.
  _taskIdMap: new Map(),
  _pendingTaskCreatesMap: new Map(),
}

/**
 * Reducer for events and connection state.
 */
export function eventsReducer(state, action) {
  switch (action.type) {
    case 'EVENT_RECEIVED': {
      // Replay path - accumulates into state.pendingBatch for a single big
      // flush at REPLAY_ENDED, and updates synchronous flags so
      // replay-progress / status indicators tick per event. Use the event's
      // arrival timestamp (set in onMessage) so the silence detector sees
      // arrival-time, not reducer-dispatch-time.
      return {
        ...state,
        ...applyEventFlags(state, action.event),
        pendingBatch: [...state.pendingBatch, action.event],
        lastEventTimestamp:
          typeof action.event?.timestamp === 'number' ? action.event.timestamp : Date.now(),
      }
    }
    case 'STREAMING_FLAGS': {
      // Streaming path - applies per-event flag changes (isResponding,
      // respondingSince, compaction state) without touching pendingBatch
      // or lastEventTimestamp. The events themselves are buffered in a
      // provider-level ref and flushed into events / derived state /
      // lastEventTimestamp via FLUSH_BATCH on the 50 ms timer.
      //
      // Why this still tracks the "Working" spinner correctly: the flags
      // that drive status indicators (isResponding, respondingSince,
      // isCompacting) only change at SDK turn boundaries - most streaming
      // events leave them untouched, so the reducer returns the same flag
      // primitives, memoized value identity stays stable, and consumers
      // do not re-render. lastEventTimestamp, on the other hand, would
      // change on every event and bypass the batching entirely - kept on
      // the flush path so provider identity churns at flush rate (~20/s)
      // rather than at SDK event rate.
      return {
        ...state,
        ...applyEventFlags(state, action.event),
      }
    }
    case 'FLUSH_BATCH': {
      // Streaming flush - events arrive pre-buffered in `action.batchEvents`
      // and have already had their flag changes applied per event via
      // STREAMING_FLAGS. This case only incorporates them into the heavy
      // derived state (events, turns, todoDiffs, etc.).
      const batch = action.batchEvents || []
      if (batch.length === 0) {
        return state
      }
      return flushBatch(state, batch)
    }
    case 'RESUME_STARTED':
      return { ...state, isResuming: true }
    case 'RESUME_CLEARED':
      return { ...state, isResuming: false }
    case 'CREATING_STARTED':
      return { ...state, isCreating: true }
    case 'CREATING_ENDED':
      return { ...state, isCreating: false }
    case 'FORKING_STARTED':
      return { ...state, isForking: true }
    case 'FORKING_ENDED':
      return { ...state, isForking: false }
    case 'OPENING_BOARD_STARTED':
      return { ...state, isOpeningBoard: true }
    case 'OPENING_BOARD_ENDED':
      return { ...state, isOpeningBoard: false }
    case 'OPENING_WORKSPACE_STARTED':
      return { ...state, isOpeningWorkspace: true }
    case 'OPENING_WORKSPACE_ENDED':
      return { ...state, isOpeningWorkspace: false }
    case 'REPLAY_STARTED':
      return { ...state, isReplaying: true, replayTotal: action.count }
    case 'REPLAY_ENDED':
      // Reset isCompacting on resume: a freshly hydrated session cannot have
      // a still-live compaction in flight. Prevents an orphan compact_start
      // in the persisted log from bleeding into the resumed UI.
      return {
        ...flushBatch(state, state.pendingBatch),
        isReplaying: false,
        isResuming: false,
        isCompacting: false,
      }
    case 'CLEAR_EVENTS':
      return {
        ...initialState,
        isCreating: state.isCreating, // preserve - cleared by ChatPanel effect on connect
        isResuming: state.isResuming, // preserve - cleared by REPLAY_ENDED or timeout
      }
    default:
      return state
  }
}

/**
 * Walk a single event and derive next-state flags. Pure; isolated so both the
 * per-event replay path (EVENT_RECEIVED) and the batched streaming path
 * (FLUSH_BATCH) share identical semantics.
 */
function applyEventFlags(state, event) {
  const wasResponding = state.isResponding
  const isResponding = isRespondingEvent(event)
    ? true
    : isDoneRespondingEvent(event)
      ? false
      : wasResponding
  // Use server event timestamp for respondingSince so replayed events preserve original timing
  const eventTs = event.ts ? new Date(event.ts).getTime() : Date.now()
  return {
    isResponding,
    resultCount: wasResponding && !isResponding ? state.resultCount + 1 : state.resultCount,
    compactionCount:
      event.subtype === EventSubtype.COMPACT_BOUNDARY
        ? state.compactionCount + 1
        : state.compactionCount,
    // Defensive: a human turn boundary cannot coexist with an in-flight
    // compaction. If a user/is_human=true event arrives while compacting,
    // the prior compaction has unambiguously ended (boundary lost on
    // interrupt, error, or SDK skip). Reset to recover from stuck state.
    isCompacting: isHumanEvent(event)
      ? false
      : event.subtype === EventSubtype.COMPACT_START
        ? true
        : event.subtype === EventSubtype.COMPACT_BOUNDARY
          ? false
          : state.isCompacting,
    respondingSince:
      isResponding && !wasResponding ? eventTs : !isResponding ? null : state.respondingSince,
  }
}

/**
 * Drain a batch of events into events/derived state. `batch` is either the
 * provider's ref-buffered streaming events (FLUSH_BATCH path) or the reducer's
 * replay accumulator (REPLAY_ENDED path). Flag fields are NOT re-walked here
 * - they have already been applied per event via STREAMING_FLAGS (streaming)
 * or EVENT_RECEIVED (replay).
 */
function flushBatch(state, batch) {
  if (!batch || batch.length === 0) {
    return { ...state, pendingBatch: [] }
  }

  const visibleBatch = batch.filter(isVisibleEvent)
  const turnResults = appendTurnResults(state.turnResults, batch)
  const { turns, state: turnGroupingState } = appendTurns(
    state.turns,
    state._turnGroupingState,
    visibleBatch,
    turnResults,
  )
  const taskNotifications = appendTaskNotifications(state.taskNotifications, visibleBatch)
  // Mutually exclusive at the session level, but both pipelines run on every
  // batch - at most one produces non-empty output. Task pipeline reads the
  // result of the Todo pipeline so the merged maps converge.
  const {
    diffs: todoDiffs,
    previousTodosBySubagent: afterTodo,
    asyncTaskIdMap,
  } = appendTodoDiffs(state.todoDiffs, state._previousTodosBySubagent, state._asyncTaskIdMap, batch)
  const {
    diffs: mergedDiffs,
    previousTodosBySubagent,
    taskIdMap,
    pendingCreatesMap,
  } = appendTaskDiffs(todoDiffs, afterTodo, state._taskIdMap, state._pendingTaskCreatesMap, batch)
  const subagentLabels = appendSubagentLabels(state.subagentLabels, batch)

  // Anchor to the arrival timestamp of the LATEST event in the batch - set in
  // `onMessage` as `event.timestamp = Date.now()` at SSE arrival. Falls back to
  // `Date.now()` only when an event is missing that field. Using arrival-time
  // instead of flush-time means batched events don't appear "fresh" on flush -
  // critical for silence detection, which would otherwise reset to "now"
  // every NORMAL_BATCH_INTERVAL and never trip during streaming pauses.
  const last = batch[batch.length - 1]
  const lastEventTimestamp = typeof last?.timestamp === 'number' ? last.timestamp : Date.now()

  return {
    ...state,
    events: [...state.events, ...batch],
    pendingBatch: [],
    lastEventTimestamp,
    visibleEvents: [...state.visibleEvents, ...visibleBatch],
    turns,
    turnResults,
    taskNotifications,
    todoDiffs: mergedDiffs,
    todosBySubagent: previousTodosBySubagent,
    subagentLabels,
    _turnGroupingState: turnGroupingState,
    _previousTodosBySubagent: previousTodosBySubagent,
    _asyncTaskIdMap: asyncTaskIdMap,
    _taskIdMap: taskIdMap,
    _pendingTaskCreatesMap: pendingCreatesMap,
  }
}
