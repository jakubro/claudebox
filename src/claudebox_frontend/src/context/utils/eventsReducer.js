/** Pure events reducer and initial state; no React APIs. */

import { EventSubtype, EventType } from '../../config/schema'
import { isDoneRespondingEvent, isHumanEvent, isRespondingEvent } from '../../utils/eventPredicates'
import {
  appendBackgroundLaunches,
  appendSubagentLabels,
  appendTaskDiffs,
  appendTaskNotifications,
  appendTodoDiffs,
  appendTurnResults,
  appendTurns,
  hasUnclaimedCompletion,
  INITIAL_TURN_GROUPING_STATE,
  isVisibleEvent,
  recordTurnDurations,
  selectRunningBackgroundWork,
} from '../../utils/eventProcessing'

// One identity for "nothing running", so memoized turns comparing it by reference stay put.
const NO_BACKGROUND_WORK = Object.freeze([])

export const initialState = {
  events: [],
  isResponding: false, // Tracked incrementally: true on assistant, false on result
  resultCount: 0, // Increments on each response cycle completion (isResponding true->false)
  compactionCount: 0, // Increments on compact_boundary events (triggers queue drain)
  isCompacting: false, // True between compact_start and compact_boundary
  isResuming: false, // True from resume click until its open request settles and the replay completes
  resumeRequest: null, // Token of the open request still in flight; soft ends leave isResuming alone meanwhile
  isReplaying: false, // True from replay_started until the replay buffer finishes draining
  replayTotal: 0, // Total events to replay (for progress indicator)
  replayDrained: 0, // Replayed events materialized into turns so far (progress numerator)
  lastEventTimestamp: null, // Updated on every flush (streaming) / per event (replay) for silence detection
  respondingSince: null, // Timestamp when current response started (isResponding flipped true)
  isCreating: false, // True while new session creation is in flight
  createRequest: null, // Sequence of the create request still in flight; soft ends are ignored meanwhile
  // This tab's creations by sequence; an owner naming a creation resolves only once it is created.
  creations: { current: 0, bySeq: {} },
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
  backgroundLaunches: new Map(),
  runningBackgroundWork: NO_BACKGROUND_WORK,
  hasUnclaimedCompletion: false,
  // Log positions bounding background work: the last container restart, and the last turn end or message.
  lastRestartIndex: -1,
  lastSettledIndex: -1,
  // Internal grouping state (not exposed to consumers)
  _turnGroupingState: INITIAL_TURN_GROUPING_STATE,
  _previousTodosBySubagent: new Map(),
  _asyncTaskIdMap: new Map(),
  // TaskCreate/TaskUpdate is mutually exclusive with TodoWrite at the session level; both pipelines coexist additively.
  _taskIdMap: new Map(),
  _pendingTaskCreatesMap: new Map(),
  _backgroundBashInputs: new Map(),
  // Armed by REPLAY_STARTED; consumed by the first REPLAY_SLICE (or by REPLAY_ENDED for an empty
  // replay) to replace the transcript instead of extending it - see replayResetState below.
  _replayReplace: false,
}

export function eventsReducer(state, action) {
  switch (action.type) {
    case 'REPLAY_SLICE': {
      // Committing in slices lets the browser paint between commits, so a heavy session doesn't lock the tab.
      const batch = action.batchEvents || []
      if (batch.length === 0) {
        return state
      }
      // The first slice under an armed mark replaces the transcript instead of extending it -
      // consumed here so every later slice in this same replay folds onto the new base normally.
      const base = state._replayReplace ? replayResetState(state) : state
      return {
        ...flushBatch({ ...base, ...foldEventFlags(base, batch) }, batch),
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
      return { ...state, isResuming: true, resumeRequest: action.token }
    case 'RESUME_REQUEST_SETTLED':
      return state.resumeRequest === action.token ? { ...state, resumeRequest: null } : state
    case 'RESUME_CLEARED':
      return { ...state, isResuming: false, resumeRequest: null }
    case 'CREATING_STARTED':
      return {
        ...state,
        isCreating: true,
        createRequest: action.seq,
        creations: nextCreations(state.creations, action),
      }
    case 'CREATE_REQUEST_SETTLED':
      return {
        ...state,
        createRequest: state.createRequest === action.seq ? null : state.createRequest,
        creations: nextCreations(state.creations, action),
      }
    case 'CREATING_FAILED': {
      const isCurrent = state.createRequest === action.seq
      return {
        ...state,
        isCreating: isCurrent ? false : state.isCreating,
        createRequest: isCurrent ? null : state.createRequest,
        creations: nextCreations(state.creations, action),
      }
    }
    case 'CREATION_ROUTED':
      return { ...state, creations: nextCreations(state.creations, action) }
    case 'CREATING_ENDED':
      return state.createRequest === null ? { ...state, isCreating: false } : state
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
      return {
        ...state,
        isReplaying: true,
        replayTotal: action.count,
        replayDrained: 0,
        _replayReplace: true,
      }
    case 'REPLAY_ENDED': {
      // An empty replay never reaches REPLAY_SLICE, so the mark is still armed here - consume it.
      const base = state._replayReplace ? replayResetState(state) : state
      // Dispatched only after the replay buffer fully drains, so every replayed event is already in derived state.
      // Resets isCompacting: a freshly hydrated session can't have a live compaction.
      // Avoids an orphan compact_start in the persisted log bleeding into the resumed UI.
      return {
        ...base,
        isReplaying: false,
        isResuming: state.resumeRequest !== null,
        isCompacting: false,
      }
    }
    case 'CLEAR_EVENTS':
      return { ...initialState, ...requestState(state) }
    case 'REPLAY_ABANDONED':
      // Unlike CLEAR_EVENTS, spares content - the new connection's own replay replaces it via the
      // rearmed mark, with no blank frame in between.
      return {
        ...state,
        isResponding: false,
        resultCount: 0,
        compactionCount: 0,
        isCompacting: false,
        isReplaying: false,
        replayTotal: 0,
        replayDrained: 0,
        lastEventTimestamp: null,
        respondingSince: null,
        _replayReplace: true,
      }
    default:
      return state
  }
}

/**
 * Apply a creation action to the creation record; pure, so the context can mirror the record in a
 * ref for synchronous reads.
 */
export function nextCreations(creations, action) {
  const entry = creations.bySeq[action.seq]

  switch (action.type) {
    case 'CREATING_STARTED':
      return {
        current: action.seq,
        bySeq: {
          ...creations.bySeq,
          [action.seq]: {
            status: 'pending',
            sessionId: null,
            fromRoute: action.fromRoute ?? null,
            ...(action.carried?.length > 0 && { carried: action.carried }),
          },
        },
      }
    case 'CREATE_REQUEST_SETTLED':
      return entry?.status === 'pending'
        ? withEntry(creations, action.seq, {
            status: 'created',
            sessionId: action.sessionId ?? null,
            ...openingAnswer(action.answer),
          })
        : creations
    case 'CREATING_FAILED':
      return entry?.status === 'pending'
        ? withEntry(creations, action.seq, { status: 'failed' })
        : creations
    case 'CREATION_ROUTED':
      return entry?.status === 'created'
        ? withEntry(creations, action.seq, { status: 'routed' })
        : creations
    case 'OPENING_PLACED':
      return entry ? withoutField(creations, action.seq, action.field) : creations
    default:
      return creations
  }
}

function openingAnswer({ undeliveredMessages = [], bundleMessages = [] } = {}) {
  const blocked = undeliveredMessages.length > 0
  return blocked || bundleMessages.length > 0 ? { answer: { blocked, bundle: bundleMessages } } : {}
}

function withEntry(creations, seq, patch) {
  return {
    ...creations,
    bySeq: { ...creations.bySeq, [seq]: { ...creations.bySeq[seq], ...patch } },
  }
}

function withoutField(creations, seq, field) {
  const entry = { ...creations.bySeq[seq] }
  delete entry[field]
  return { ...creations, bySeq: { ...creations.bySeq, [seq]: entry } }
}

/** The loading flags, their request markers and the creation record - kept across every reset. */
function requestState(state) {
  return {
    isCreating: state.isCreating,
    isResuming: state.isResuming,
    resumeRequest: state.resumeRequest,
    createRequest: state.createRequest,
    creations: state.creations,
  }
}

function replayResetState(state) {
  return {
    ...initialState,
    ...requestState(state),
    isReplaying: state.isReplaying,
    replayTotal: state.replayTotal,
    replayDrained: state.replayDrained,
    _replayReplace: false,
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
  const { turns: grouped, state: turnGroupingState } = appendTurns(
    state.turns,
    state._turnGroupingState,
    visibleBatch,
    turnResults,
  )
  const turns = recordTurnDurations(grouped, batch)
  const baseIndex = state.events.length
  const taskNotifications = appendTaskNotifications(state.taskNotifications, batch, baseIndex)
  const { launches: backgroundLaunches, bashInputs: backgroundBashInputs } =
    appendBackgroundLaunches(
      state.backgroundLaunches,
      state._backgroundBashInputs,
      batch,
      baseIndex,
    )
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
  const lastRestartIndex = lastIndexOf(batch, baseIndex, isContainerRestart, state.lastRestartIndex)
  const lastSettledIndex = lastIndexOf(batch, baseIndex, isSettlingEvent, state.lastSettledIndex)

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
    backgroundLaunches,
    runningBackgroundWork:
      backgroundLaunches === state.backgroundLaunches &&
      taskNotifications === state.taskNotifications &&
      lastRestartIndex === state.lastRestartIndex
        ? state.runningBackgroundWork
        : runningOrNone(backgroundLaunches, taskNotifications, lastRestartIndex),
    hasUnclaimedCompletion: hasUnclaimedCompletion(
      backgroundLaunches,
      taskNotifications,
      lastSettledIndex,
      lastRestartIndex,
    ),
    lastRestartIndex,
    lastSettledIndex,
    _turnGroupingState: turnGroupingState,
    _previousTodosBySubagent: previousTodosBySubagent,
    _asyncTaskIdMap: asyncTaskIdMap,
    _taskIdMap: taskIdMap,
    _pendingTaskCreatesMap: pendingCreatesMap,
    _backgroundBashInputs: backgroundBashInputs,
  }
}

function runningOrNone(launches, taskNotifications, lastRestartIndex) {
  const running = selectRunningBackgroundWork(launches, taskNotifications, lastRestartIndex)
  return running.length > 0 ? running : NO_BACKGROUND_WORK
}

function lastIndexOf(batch, baseIndex, predicate, previous) {
  for (let i = batch.length - 1; i >= 0; i--) {
    if (predicate(batch[i])) {
      return baseIndex + i
    }
  }
  return previous
}

function isContainerRestart(event) {
  return event.type === EventType.SYSTEM && event.subtype === EventSubtype.CONTAINER_RESTARTED
}

function isSettlingEvent(event) {
  return isDoneRespondingEvent(event) || (isHumanEvent(event) && !event.parent_tool_use_id)
}
