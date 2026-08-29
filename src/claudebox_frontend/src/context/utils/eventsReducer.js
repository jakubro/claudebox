/** Pure events reducer and initial state; no React APIs. */

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
  isResponding: false, // Tracked incrementally: true on assistant, false on result
  resultCount: 0, // Increments on each response cycle completion (isResponding true->false)
  compactionCount: 0, // Increments on compact_boundary events (triggers queue drain)
  isCompacting: false, // True between compact_start and compact_boundary
  isResuming: false, // True from resume click until replay completes
  isReplaying: false, // True from replay_started until the replay buffer finishes draining
  replayTotal: 0, // Total events to replay (for progress indicator)
  replayDrained: 0, // Replayed events materialized into turns so far (progress numerator)
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
  // TaskCreate/TaskUpdate is mutually exclusive with TodoWrite at the session level; both pipelines coexist additively.
  _taskIdMap: new Map(),
  _pendingTaskCreatesMap: new Map(),
}

export function eventsReducer(state, action) {
  switch (action.type) {
    case 'REPLAY_SLICE': {
      // Committing in slices lets the browser paint between commits, so a heavy session doesn't lock the tab.
      const batch = action.batchEvents || []
      if (batch.length === 0) {
        return state
      }
      return {
        ...flushBatch({ ...state, ...foldEventFlags(state, batch) }, batch),
        replayDrained: state.replayDrained + batch.length,
      }
    }
    case 'STREAMING_FLAGS': {
      // Applies per-event flags (isResponding, respondingSince, compaction) without touching derived state.
      // Status flags only change at SDK turn boundaries, so most events don't trigger a re-render.
      // lastEventTimestamp changes every event, so it's deferred to FLUSH_BATCH to keep churn at flush rate.
      return {
        ...state,
        ...applyEventFlags(state, action.event),
      }
    }
    case 'FLUSH_BATCH': {
      // Streaming flush: events in `action.batchEvents` already had flags applied via STREAMING_FLAGS.
      // This only folds them into heavy derived state (events, turns, todoDiffs, etc.).
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
      return { ...state, isReplaying: true, replayTotal: action.count, replayDrained: 0 }
    case 'REPLAY_ENDED':
      // Dispatched only after the replay buffer fully drains, so every replayed event is already in derived state.
      // Resets isCompacting: a freshly hydrated session can't have a live compaction.
      // Avoids an orphan compact_start in the persisted log bleeding into the resumed UI.
      return {
        ...state,
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

/** Derives next-state flags for a single event; pure and isolated so REPLAY_SLICE and STREAMING_FLAGS share identical semantics. */
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
    // Defensive: a human turn boundary can't coexist with an in-flight compaction. If a
    // user/is_human=true event arrives while compacting, the prior compaction has unambiguously
    // ended (boundary lost to interrupt, error, or SDK skip); reset to recover from stuck state.
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

/** Folds applyEventFlags across a batch in arrival order, returning only the flag fields, without rebuilding the whole state object once per event. */
function foldEventFlags(state, batch) {
  let flags = state

  for (const event of batch) {
    flags = applyEventFlags(flags, event)
  }

  return flags
}

/**
 * Drains a batch into events/derived state; `batch` is either FLUSH_BATCH's streaming events or one REPLAY_SLICE.
 * Flag fields aren't re-walked here - already applied via STREAMING_FLAGS (streaming) or foldEventFlags (replay).
 *
 * Exported so a one-shot, non-streaming consumer can derive the same shape from a persisted event
 * array in one call - `flushBatch(initialState, events)` - rather than a second turn builder.
 */
export function flushBatch(state, batch) {
  if (!batch || batch.length === 0) {
    return state
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
  // Mutually exclusive at the session level, but both pipelines run on every batch; at most one produces output.
  // The task pipeline reads the todo pipeline's result, so the maps merge.
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

  // Anchors to the latest event's arrival timestamp (set in `onMessage`), falling back to `Date.now()` if missing.
  // Arrival time keeps silence detection accurate; flush time would never trip during streaming pauses.
  const last = batch[batch.length - 1]
  const lastEventTimestamp = typeof last?.timestamp === 'number' ? last.timestamp : Date.now()

  return {
    ...state,
    events: [...state.events, ...batch],
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
