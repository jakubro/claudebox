/** Event processing utilities for rendering chat turns. */

import {
  BlockType,
  EventSubtype,
  EventType,
  NotificationStatus,
  SdkProtocol,
  TaskStatus,
  TodoStatus,
  ToolName,
} from '../config/schema'
import { isAsyncTask, isHumanEvent } from './eventPredicates'

/**
 * Initial state for incremental turn grouping across batches.
 */
export const INITIAL_TURN_GROUPING_STATE = {
  currentTurnIndex: null,
  compactionStartTurnIndex: null,
  pendingCompactionEvents: null,
}

const SETTING_CHANGE_SUBTYPES = new Set([
  EventSubtype.MODEL_CHANGED,
  EventSubtype.PERMISSION_MODE_CHANGED,
  EventSubtype.EFFORT_LEVEL_CHANGED,
  EventSubtype.CONTAINER_RESTARTED,
])

/** Pattern for detecting embedded thinking XML in text content. */
const THINKING_XML_PATTERN = /<thinking>[\s\S]*?<\/thinking>/

/** Pattern to extract task_id attributes from notification XML tags. */
const NOTIFICATION_TASK_ID_PATTERN =
  /<(?:task-notification|agent-notification)\s+task_id="([^"]+)"/g

/**
 * Compute threshold-filtered timing offsets for a list of event timestamps.
 * Returns an array of (offset in seconds | null) — null when delta from last shown is below threshold.
 */
export function computeTimingOffsets(eventTimestamps, turnStartTime, threshold = 30) {
  if (!turnStartTime) {
    return eventTimestamps.map(() => null)
  }
  let lastShown = 0
  return eventTimestamps.map(ts => {
    if (!ts) {
      return null
    }
    const offset = Math.max(0, Math.floor((new Date(ts).getTime() - turnStartTime) / 1000))
    if (offset - lastShown >= threshold) {
      lastShown = offset
      return offset
    }
    return null
  })
}

/**
 * Index events for fast lookup during block creation.
 * First pass of event processing - builds indexes for tool results, nested events, etc.
 */
export function indexEvents(events) {
  const toolResults = new Map()
  const nestedEvents = new Map()
  const skillContent = new Map()
  const compactionSummary = new Map()

  const hasCompactBoundary = events.some(e => e.subtype === EventSubtype.COMPACT_BOUNDARY)

  let lastSkillToolUseId = null
  let lastCompactEventId = null

  for (const event of events) {
    const parentId = event.parent_tool_use_id

    if (event.subtype === EventSubtype.TOOL_RESULT) {
      const toolUseId = event.tool_use_id
      if (toolUseId) {
        toolResults.set(toolUseId, event)
      }
    }

    if (event.subtype === EventSubtype.COMPACT_BOUNDARY) {
      lastCompactEventId = event.id
      lastSkillToolUseId = null
    } else if (event.subtype === EventSubtype.TOOL_USE && event.content === ToolName.SKILL) {
      lastSkillToolUseId = event.tool_use_id
      lastCompactEventId = null
    } else if (event.type === EventType.USER && !event.is_human) {
      // Non-human user messages: compaction summary/output or skill content
      if (lastCompactEventId) {
        if (!compactionSummary.has(lastCompactEventId)) {
          compactionSummary.set(lastCompactEventId, [])
        }
        compactionSummary.get(lastCompactEventId).push(event.content)
        // Don't clear lastCompactEventId - keep pairing subsequent messages
      } else if (event.subtype === EventSubtype.TEXT && lastSkillToolUseId) {
        skillContent.set(lastSkillToolUseId, event.content)
        lastSkillToolUseId = null
      }
    } else if (event.subtype !== EventSubtype.TOOL_RESULT) {
      lastSkillToolUseId = null
      lastCompactEventId = null
    }

    if (parentId) {
      if (!nestedEvents.has(parentId)) {
        nestedEvents.set(parentId, [])
      }
      nestedEvents.get(parentId).push(event)
    }
  }

  return { toolResults, nestedEvents, skillContent, compactionSummary, hasCompactBoundary }
}

/**
 * Extract `<thinking>` XML blocks from text content into ordered segments.
 * Returns array of {type: 'thinking'|'text', content} segments preserving order.
 */
export function extractThinkingFromText(content) {
  const pattern = /<thinking>([\s\S]*?)<\/thinking>/g
  const segments = []
  let lastIndex = 0

  for (const match of content.matchAll(pattern)) {
    const textBefore = content.slice(lastIndex, match.index).trim()
    if (textBefore) {
      segments.push({ type: BlockType.TEXT, content: textBefore })
    }
    const thinkingContent = match[1].trim()
    if (thinkingContent) {
      segments.push({ type: BlockType.THINKING, content: thinkingContent })
    }
    lastIndex = match.index + match[0].length
  }

  const textAfter = content.slice(lastIndex).trim()
  if (textAfter) {
    segments.push({ type: BlockType.TEXT, content: textAfter })
  }

  return segments
}

/**
 * Process events into renderable blocks.
 * Pairs tool_use with corresponding tool_result.
 * Groups nested subagent events under parent Task.
 * Attaches skill markdown to Skill tool blocks.
 * Pairs compact_start with compact_boundary for progress indication.
 * Extracts embedded `<thinking>` XML from assistant text into separate thinking blocks.
 * @param {Array} events - Events to process.
 */
export function processEvents(events) {
  const blocks = []
  const { toolResults, nestedEvents, skillContent, compactionSummary, hasCompactBoundary } =
    indexEvents(events)

  // Second pass: create renderable blocks (skip nested events, skill markdown, and compaction summaries)
  for (const event of events) {
    // Skip events that belong to a parent - they're rendered nested under Task block
    // Check both locations (see indexEvents for explanation)
    const parentId = event.parent_tool_use_id
    if (parentId) {
      continue
    }

    if (event.subtype === EventSubtype.TEXT && event.content?.trim()) {
      // Filter "(No content)" placeholder emitted when assistant starts with thinking/tool use
      if (
        event.type === EventType.ASSISTANT &&
        event.content.trim().toLowerCase() === SdkProtocol.PLACEHOLDER_CONTENT
      ) {
        continue
      }
      // Skip user text that was attached to a Skill or compaction block
      if (event.type === EventType.USER && !event.is_human) {
        const isSkillMarkdown = [...skillContent.values()].includes(event.content)
        const isCompactionContent = [...compactionSummary.values()].some(arr =>
          arr.includes(event.content),
        )
        // Skip task/agent notification XML (used for correlation, not display)
        const isNotificationXml = /<(task-notification|agent-notification)[\s>]/.test(event.content)
        // Skip redundant model-set and effort-set echoes (shown via changed events)
        const isModelSetEcho = SdkProtocol.MODEL_SET_PATTERN.test(event.content?.trim())
        const isEffortSetEcho = SdkProtocol.EFFORT_SET_PATTERN.test(event.content?.trim())
        if (
          isSkillMarkdown ||
          isCompactionContent ||
          isNotificationXml ||
          isModelSetEcho ||
          isEffortSetEcho
        ) {
          continue
        }
        // Interrupt acknowledgment — skip entirely, the interrupted turn border is sufficient
        if (isInterruptAck(event)) {
          continue
        }
      }
      // Extract embedded <thinking> XML from assistant text into separate blocks
      if (event.type === EventType.ASSISTANT && THINKING_XML_PATTERN.test(event.content)) {
        for (const segment of extractThinkingFromText(event.content)) {
          if (segment.type === BlockType.THINKING) {
            blocks.push({
              type: BlockType.THINKING,
              event: { ...event, content: segment.content, subtype: EventSubtype.THINKING },
            })
          } else {
            blocks.push({ type: BlockType.TEXT, event: { ...event, content: segment.content } })
          }
        }
      } else {
        blocks.push({ type: BlockType.TEXT, event })
      }
    } else if (event.subtype === EventSubtype.THINKING) {
      if (event.content?.trim()) {
        blocks.push({ type: BlockType.THINKING, event })
      }
    } else if (event.subtype === EventSubtype.TOOL_USE) {
      const toolUseId = event.tool_use_id
      const result = toolUseId ? toolResults.get(toolUseId) : null
      const nested = toolUseId ? nestedEvents.get(toolUseId) : null
      const skill = toolUseId ? skillContent.get(toolUseId) : null
      blocks.push({
        type: BlockType.TOOL,
        toolUse: event,
        toolResult: result,
        nestedEvents: nested,
        skillContent: skill,
      })
    } else if (event.subtype === EventSubtype.COMPACT_START) {
      // Show compacting progress only if boundary hasn't arrived yet
      if (!hasCompactBoundary) {
        blocks.push({ type: BlockType.COMPACTION, event, isCompacting: true })
      }
    } else if (event.subtype === EventSubtype.COMPACT_BOUNDARY) {
      const summary = compactionSummary.get(event.id)
      blocks.push({ type: BlockType.COMPACTION, event, summary, isCompacting: false })
    }
    // tool_result handled via pairing above
    // model_changed / permission_mode_changed handled via turn.settingChanges (rendered outside turn bubble)
  }

  return blocks
}

/**
 * Process nested events into tool blocks for rendering.
 * Used for subagent (Task) nested tool calls.
 * Skips human-marked events (Task prompts) - they're internal, not shown.
 */
export function processNestedEvents(events) {
  if (!events) {
    return []
  }

  const blocks = []
  const toolResults = new Map()

  // Index tool_results (skip human-marked events like Task prompts)
  for (const event of events) {
    if (event.is_human) {
      continue
    }
    if (event.subtype === EventSubtype.TOOL_RESULT) {
      const toolUseId = event.tool_use_id
      if (toolUseId) {
        toolResults.set(toolUseId, event)
      }
    }
  }

  // Create blocks for tool_use events only (skip text/thinking in nested)
  for (const event of events) {
    if (event.is_human) {
      continue
    }
    if (event.subtype === EventSubtype.TOOL_USE) {
      const toolUseId = event.tool_use_id
      const result = toolUseId ? toolResults.get(toolUseId) : null
      blocks.push({ toolUse: event, toolResult: result })
    }
  }

  return blocks
}

/**
 * Test whether event is an SDK interrupt acknowledgment.
 */
export function isInterruptAck(event) {
  return (
    event.type === EventType.USER &&
    !event.is_human &&
    event.subtype === EventSubtype.TEXT &&
    SdkProtocol.INTERRUPT_ACK_PATTERN.test(event.content?.trim())
  )
}

/** Test whether an event should be visible in the chat UI. */
export function isVisibleEvent(event) {
  if (
    event.type === EventType.SYSTEM &&
    (event.subtype === EventSubtype.HOOK_RESPONSE || event.subtype === EventSubtype.INIT)
  ) {
    return false
  }
  return event.type !== EventType.RESULT
}

/** Incrementally append visible events to existing turns. */
export function appendTurns(prevTurns, prevState, newVisibleEvents, turnResults = {}) {
  if (newVisibleEvents.length === 0) {
    return { turns: prevTurns, state: prevState }
  }

  const turns = [...prevTurns]
  let { currentTurnIndex, compactionStartTurnIndex } = prevState
  const cloned = new Set()

  // Buffered compaction events — flushed into the new assistant turn
  let pendingCompactionEvents = prevState.pendingCompactionEvents
    ? [...prevState.pendingCompactionEvents]
    : []

  // Clone turn at index for immutable modification
  function cloneTurn(idx) {
    if (!cloned.has(idx)) {
      turns[idx] = {
        ...turns[idx],
        events: [...turns[idx].events],
        settingChanges: [...(turns[idx].settingChanges || [])],
      }
      cloned.add(idx)
    }
    return turns[idx]
  }

  // Flush buffered compaction events into the target turn
  function flushCompaction(targetIdx) {
    if (pendingCompactionEvents.length === 0) {
      return
    }
    const turn = cloneTurn(targetIdx)
    for (const buffered of pendingCompactionEvents) {
      turn.events.push(buffered)
    }
    pendingCompactionEvents = []
    compactionStartTurnIndex = null
  }

  for (const event of newVisibleEvents) {
    const isNested = !!event.parent_tool_use_id

    if (isHumanEvent(event) && !isNested) {
      currentTurnIndex = turns.length
      turns.push(createTurn(event.turn_id, event.content, [], event.attachments || null))
      cloned.add(currentTurnIndex)
    } else if (event.type === EventType.SYSTEM && event.subtype === EventSubtype.INTERRUPT_SENT) {
      // Skip if this turn already completed successfully — the interrupt arrived after
      // the result and shouldn't mark the finished turn as interrupted
      const alreadyCompleted = event.turn_id && turnResults[event.turn_id] === 'success'
      if (!alreadyCompleted && currentTurnIndex != null) {
        cloneTurn(currentTurnIndex).interrupted = true
      }
    } else if (isSettingChangeOrRestart(event)) {
      // Setting-change and container-restart dividers stored separately, rendered outside turn bubbles.
      // Skip setting-change initialization events (no previous value); container_restarted always renders.
      if (!isSettingInit(event) && currentTurnIndex != null) {
        cloneTurn(currentTurnIndex).settingChanges.push(event)
      }
    } else if (
      isNested ||
      event.type === EventType.ASSISTANT ||
      event.subtype === EventSubtype.TOOL_RESULT ||
      event.subtype === EventSubtype.COMPACT_START ||
      event.subtype === EventSubtype.COMPACT_BOUNDARY ||
      (event.type === EventType.USER && !event.is_human)
    ) {
      if (event.subtype === EventSubtype.COMPACT_START) {
        // Buffer compact_start — don't place yet, the new turn hasn't been created
        compactionStartTurnIndex = currentTurnIndex
        pendingCompactionEvents.push(event)
      } else if (event.subtype === EventSubtype.COMPACT_BOUNDARY) {
        // Buffer compact_boundary alongside compact_start
        pendingCompactionEvents.push(event)
      } else if (
        event.type === EventType.USER &&
        !event.is_human &&
        compactionStartTurnIndex != null
      ) {
        // Post-compaction context (non-human user text) — buffer with compaction events
        pendingCompactionEvents.push(event)
      } else {
        // Non-compaction event — flush any buffered compaction events first
        if (pendingCompactionEvents.length > 0 && currentTurnIndex != null) {
          flushCompaction(currentTurnIndex)
        }

        if (currentTurnIndex != null) {
          cloneTurn(currentTurnIndex).events.push(event)
        } else {
          turns.push(createTurn(event.turn_id, null, [event]))
          cloned.add(turns.length - 1)
          // Don't update currentTurnIndex — orphan turns match groupIntoTurns behavior
        }
      }
    }
  }

  // Flush remaining compaction events so in-progress compaction blocks render.
  // The events stay in the turn for the next batch — when compact_boundary arrives,
  // eventsToBlocks suppresses the compact_start block and shows the completed one.
  if (pendingCompactionEvents.length > 0 && currentTurnIndex != null) {
    flushCompaction(currentTurnIndex)
  }

  return {
    turns,
    state: {
      currentTurnIndex,
      compactionStartTurnIndex,
      pendingCompactionEvents: null,
    },
  }
}

/**
 * Append result events from a batch to existing turn results map.
 * Returns original reference if no new results found.
 */
export function appendTurnResults(existing, newEvents) {
  let updated = null
  for (const e of newEvents) {
    if (e.type === EventType.RESULT && e.turn_id) {
      if (!updated) {
        updated = { ...existing }
      }
      updated[e.turn_id] = e.subtype
    }
  }
  return updated || existing
}

/**
 * Append task notifications from new visible events to existing notifications map.
 * Returns original reference if no new notifications found.
 */
export function appendTaskNotifications(existing, newVisibleEvents) {
  let notifications

  for (const event of newVisibleEvents) {
    if (event.type === EventType.SYSTEM && event.subtype === EventSubtype.TASK_NOTIFICATION) {
      const data = event.message_data
      if (data?.task_id) {
        if (!notifications) {
          notifications = new Map(existing)
        }
        const content = data.content || data.summary || data.status || 'Completed'
        notifications.set(data.task_id, {
          status: data.status || NotificationStatus.COMPLETED,
          summary: content.split('\n')[0],
          content,
        })
      }
      continue
    }

    if (
      event.type === EventType.USER &&
      event.subtype === EventSubtype.TEXT &&
      !event.is_human &&
      event.content
    ) {
      if (!notifications) {
        notifications = new Map(existing)
      }
      _parseNotificationTags(event.content, 'task-notification', notifications)
      _parseNotificationTags(event.content, 'agent-notification', notifications)
    }
  }

  return notifications || existing
}

/**
 * Append todo diffs from new events to existing diffs map.
 * Tracks per-subagent previous state so each subagent's diff is computed against its own history.
 * Handles cleanup for both sync tasks (tool_result) and async tasks (task_notification).
 * @param {Map} existing - Existing todoDiffs map (toolUseId → diff).
 * @param {Map} previousTodosBySubagent - Map of subagentKey → previous todos array.
 * @param {Map} asyncTaskIdMap - Map of asyncTaskId (agentId) → tool_use_id for async correlation.
 * @param {Array} newEvents - New events to process.
 * @returns {{ diffs: Map, previousTodosBySubagent: Map, asyncTaskIdMap: Map }}
 */
export function appendTodoDiffs(existing, previousTodosBySubagent, asyncTaskIdMap, newEvents) {
  let diffs = null
  let prevMap = previousTodosBySubagent
  let asyncMap = asyncTaskIdMap

  for (const event of newEvents) {
    if (event.subtype === EventSubtype.TOOL_USE && event.content === ToolName.TODO_WRITE) {
      const toolUseId = event.tool_use_id
      const subagentKey = event.parent_tool_use_id || 'main'
      const raw = event.tool_input?.todos
      const currentTodos = Array.isArray(raw) ? raw : []
      const prevTodos = prevMap.get(subagentKey) || []
      const diff = computeSingleDiff(prevTodos, currentTodos)
      if (toolUseId) {
        if (!diffs) {
          diffs = new Map(existing)
        }
        diffs.set(toolUseId, diff)
      }
      if (prevMap === previousTodosBySubagent) {
        prevMap = new Map(previousTodosBySubagent)
      }
      prevMap.set(subagentKey, currentTodos)
    }

    // Sync task cleanup: tool_result whose tool_use_id matches a tracked subagent
    if (event.subtype === EventSubtype.TOOL_RESULT) {
      if (prevMap.has(event.tool_use_id)) {
        if (prevMap === previousTodosBySubagent) {
          prevMap = new Map(previousTodosBySubagent)
        }
        prevMap.delete(event.tool_use_id)
      }
      // Record agentId → tool_use_id for later async notification correlation
      const tur = event.tool_use_result
      if (tur?.isAsync && tur.agentId) {
        if (asyncMap === asyncTaskIdMap) {
          asyncMap = new Map(asyncTaskIdMap)
        }
        asyncMap.set(tur.agentId, event.tool_use_id)
      }
    }

    // Async task cleanup: resolve task_ids from notifications to tool_use_ids
    for (const toolUseId of _resolveAsyncTaskIds(event, asyncMap)) {
      if (prevMap.has(toolUseId)) {
        if (prevMap === previousTodosBySubagent) {
          prevMap = new Map(previousTodosBySubagent)
        }
        prevMap.delete(toolUseId)
      }
    }
  }

  return {
    diffs: diffs || existing,
    previousTodosBySubagent: prevMap,
    asyncTaskIdMap: asyncMap,
  }
}

/**
 * Append task diffs from TaskCreate / TaskUpdate events.
 *
 * Mirrors appendTodoDiffs but for the Task tracker family.
 * TaskCreate adds an item; TaskUpdate mutates an item by taskId. Both feed the
 * same todoDiffs + todosBySubagent stores so the panel and in-chat block stay
 * source-agnostic.
 *
 * @param {Map} existing - Existing todoDiffs map (toolUseId → diff).
 * @param {Map} previousTodosBySubagent - Map of subagentKey → current todos array.
 * @param {Map} taskIdMap - Map of taskId → { subagentKey, index } binding for
 *   updates. Populated from TaskCreate tool_result.
 * @param {Map} pendingCreatesMap - Map of tool_use_id → pending TaskCreate
 *   metadata, used to bind the taskId returned by the tool_result back to a
 *   subagent + list-position.
 * @param {Array} newEvents - New events to process.
 * @returns {{ diffs: Map, previousTodosBySubagent: Map, taskIdMap: Map, pendingCreatesMap: Map }}
 */
export function appendTaskDiffs(
  existing,
  previousTodosBySubagent,
  taskIdMap,
  pendingCreatesMap,
  newEvents,
) {
  const ctx = {
    diffs: null,
    prevMap: previousTodosBySubagent,
    idMap: taskIdMap,
    pendingMap: pendingCreatesMap,
    existing,
    initialPrev: previousTodosBySubagent,
    initialId: taskIdMap,
    initialPending: pendingCreatesMap,
  }

  for (const event of newEvents) {
    if (event.subtype === EventSubtype.TOOL_USE && event.content === ToolName.TASK_CREATE) {
      _applyTaskCreate(ctx, event)
    } else if (event.subtype === EventSubtype.TOOL_USE && event.content === ToolName.TASK_UPDATE) {
      _applyTaskUpdate(ctx, event)
    } else if (event.subtype === EventSubtype.TOOL_RESULT) {
      _applyTaskResult(ctx, event)
    }
  }

  return {
    diffs: ctx.diffs || existing,
    previousTodosBySubagent: ctx.prevMap,
    taskIdMap: ctx.idMap,
    pendingCreatesMap: ctx.pendingMap,
  }
}

/** Append a new pending item for a TaskCreate tool_use and pend taskId binding. */
function _applyTaskCreate(ctx, event) {
  const toolUseId = event.tool_use_id
  if (!toolUseId) {
    return
  }
  const input = event.tool_input || {}
  const newItem = {
    content: input.subject || '',
    subtitle: input.description || null,
    status: 'pending',
    activeForm: input.activeForm || '',
  }
  const subagentKey = event.parent_tool_use_id || 'main'

  _ensureDiffsMap(ctx)
  ctx.diffs.set(toolUseId, { added: [newItem], started: [], completed: [], removed: [] })

  _ensurePrevMap(ctx)
  const list = [...(ctx.prevMap.get(subagentKey) || []), newItem]
  ctx.prevMap.set(subagentKey, list)

  _ensurePendingMap(ctx)
  ctx.pendingMap.set(toolUseId, { subagentKey, index: list.length - 1 })
}

/** Apply status / addBlockedBy transitions for a TaskUpdate tool_use. */
function _applyTaskUpdate(ctx, event) {
  const toolUseId = event.tool_use_id
  if (!toolUseId) {
    return
  }
  const input = event.tool_input || {}
  const taskId = input.taskId
  const newStatus = input.status // 'in_progress' | 'completed' | undefined
  const addBlockedBy = Array.isArray(input.addBlockedBy) ? input.addBlockedBy : null

  const bind = taskId != null ? ctx.idMap.get(String(taskId)) : null
  const current = bind ? (ctx.prevMap.get(bind.subagentKey) || [])[bind.index] : null
  const updated = _mergeTaskUpdate(current, taskId, newStatus, addBlockedBy)

  if (bind) {
    _ensurePrevMap(ctx)
    const next = [...(ctx.prevMap.get(bind.subagentKey) || [])]
    next[bind.index] = updated
    ctx.prevMap.set(bind.subagentKey, next)
  }

  _ensureDiffsMap(ctx)
  ctx.diffs.set(toolUseId, _classifyTaskUpdateDiff(updated, newStatus, addBlockedBy))
}

/** Bind the numeric taskId returned by TaskCreate to its subagent + list-position. */
function _applyTaskResult(ctx, event) {
  const pending = ctx.pendingMap.get(event.tool_use_id)
  const taskIdFromResult = event.tool_use_result?.task?.id
  if (!(pending && taskIdFromResult != null)) {
    return
  }
  const taskIdStr = String(taskIdFromResult)
  _ensureIdMap(ctx)
  ctx.idMap.set(taskIdStr, pending)
  _ensurePendingMap(ctx)
  ctx.pendingMap.delete(event.tool_use_id)

  // Back-patch _taskId onto the bound item so the in-chat grouped renderer can
  // dedup by identity (one row per _taskId within the run). Mutation is safe:
  // _applyTaskCreate pushed the SAME item reference to both
  // ctx.prevMap[subagentKey] and ctx.diffs.get(creatingToolUseId).added[0], so
  // mutating in place propagates to both consumers.
  const item = (ctx.prevMap.get(pending.subagentKey) || [])[pending.index]
  if (item) {
    item._taskId = taskIdStr
  }
}

/** Compose the updated task item by merging the existing record with the patch. */
function _mergeTaskUpdate(current, taskId, newStatus, addBlockedBy) {
  // _taskId carries from `current` when present (set by _applyTaskResult once
  // the numeric id binds), otherwise from `taskId` itself (the TaskUpdate
  // payload's taskId, stringified). Preserving it on the merged record keeps
  // dedup-by-identity working through update cycles.
  const taskIdStr = current?._taskId || (taskId != null ? String(taskId) : null)
  return {
    content: current?.content || `Task #${taskId ?? '?'}`,
    subtitle: current?.subtitle || null,
    activeForm: current?.activeForm || '',
    status: newStatus || current?.status || 'pending',
    blockedBy:
      addBlockedBy && addBlockedBy.length > 0
        ? [...(current?.blockedBy || []), ...addBlockedBy]
        : current?.blockedBy || null,
    _taskId: taskIdStr,
  }
}

/** Place the updated task in the per-call diff bucket that matches the transition. */
function _classifyTaskUpdateDiff(updated, newStatus, addBlockedBy) {
  const diff = { added: [], started: [], completed: [], removed: [] }
  if (newStatus === 'in_progress') {
    diff.started.push(updated)
  } else if (newStatus === 'completed') {
    diff.completed.push(updated)
  } else if (addBlockedBy && addBlockedBy.length > 0) {
    // Pure blocked-by update — surface via added bucket so TodoList shows
    // the chip without misclassifying the transition.
    diff.added.push(updated)
  }
  return diff
}

function _ensureDiffsMap(ctx) {
  if (!ctx.diffs) {
    ctx.diffs = new Map(ctx.existing)
  }
}
function _ensurePrevMap(ctx) {
  if (ctx.prevMap === ctx.initialPrev) {
    ctx.prevMap = new Map(ctx.initialPrev)
  }
}
function _ensureIdMap(ctx) {
  if (ctx.idMap === ctx.initialId) {
    ctx.idMap = new Map(ctx.initialId)
  }
}
function _ensurePendingMap(ctx) {
  if (ctx.pendingMap === ctx.initialPending) {
    ctx.pendingMap = new Map(ctx.initialPending)
  }
}

/**
 * Append subagent labels from Task tool_use events.
 * Maps parent_tool_use_id → Task description for panel section headers.
 */
export function appendSubagentLabels(existing, newEvents) {
  let labels = null
  for (const event of newEvents) {
    if (event.subtype === EventSubtype.TOOL_USE && event.content === ToolName.TASK) {
      const toolUseId = event.tool_use_id
      const description = event.tool_input?.description
      if (toolUseId && description) {
        if (!labels) {
          labels = new Map(existing)
        }
        labels.set(toolUseId, description)
      }
    }
  }
  return labels || existing
}

/**
 * Extract task information from events for Tasks panel display.
 * Returns array of task objects with id, description, status, timestamps.
 */
export function extractTasks(events, taskNotifications) {
  const tasks = []
  const toolResults = new Map()

  // First pass: index tool_results
  for (const event of events) {
    if (event.subtype === EventSubtype.TOOL_RESULT) {
      const toolUseId = event.tool_use_id
      if (toolUseId) {
        toolResults.set(toolUseId, event)
      }
    }
  }

  const lastEventByParent = buildLastEventTimeMap(events)

  // Second pass: extract Task tool_use events
  for (const event of events) {
    if (event.subtype === EventSubtype.TOOL_USE && event.content === ToolName.TASK) {
      const toolUseId = event.tool_use_id
      const input = event.tool_input ?? {}
      const result = toolUseId ? toolResults.get(toolUseId) : null

      // Check for async task launch
      const toolUseResult = result?.tool_use_result
      const isAsync = isAsyncTask(toolUseResult)
      const asyncTaskId = isAsync ? toolUseResult.agentId : null

      // Look up notification for async tasks
      const notification = asyncTaskId ? taskNotifications?.get(asyncTaskId) : null

      // Derive status
      let status = TaskStatus.RUNNING
      if (isAsync) {
        if (notification) {
          status =
            notification.status === NotificationStatus.FAILED ||
            notification.status === NotificationStatus.KILLED
              ? TaskStatus.FAILED
              : TaskStatus.COMPLETED
        }
      } else if (result) {
        // Check if result indicates error
        const resultContent = result.content || ''
        const isError =
          result.is_error || resultContent.includes('Error:') || resultContent.includes('error:')
        status = isError ? TaskStatus.FAILED : TaskStatus.COMPLETED
      }

      // Use event.ts (original timestamp) not event.timestamp (arrival time)
      const startTime = event.ts ? new Date(event.ts).getTime() : event.timestamp
      const endTime = result?.ts ? new Date(result.ts).getTime() : result?.timestamp || null
      const lastEventTime = lastEventByParent.get(toolUseId) || startTime

      tasks.push({
        id: toolUseId,
        asyncTaskId,
        description: input.description || 'Task',
        prompt: input.prompt,
        status,
        startTime,
        endTime,
        lastEventTime,
        isAsync,
      })
    }
  }

  return tasks
}

/**
 * Generate a fingerprint for AskUserQuestion matching across turns.
 * Uses question headers (stable short labels) for fuzzy matching that survives SDK text reformatting.
 */
export function getAskUserFingerprint(questions) {
  if (!questions || questions.length === 0) {
    return ''
  }
  return questions
    .map(q => (q.header || '').trim().toLowerCase())
    .sort()
    .join('|')
}

/**
 * Compute set of AskUserQuestion tool_use_ids to hide across all turns.
 * Hides errored (is_error=true) attempts when a later same-fingerprint sibling exists.
 * Successfully answered questions are never hidden.
 */
export function computeDuplicateAskUserIds(turns) {
  const ids = new Set()
  const byFingerprint = new Map()

  for (const turn of turns) {
    // Index tool_results within this turn for error checking
    const toolResults = new Map()
    for (const event of turn.events) {
      if (event.subtype === EventSubtype.TOOL_RESULT && event.tool_use_id) {
        toolResults.set(event.tool_use_id, event)
      }
    }

    for (const event of turn.events) {
      if (event.subtype === EventSubtype.TOOL_USE && event.content === ToolName.ASK_USER_QUESTION) {
        const fingerprint = getAskUserFingerprint(event.tool_input?.questions)
        const result = toolResults.get(event.tool_use_id)
        const hasErrorResult = !!result?.is_error

        if (!byFingerprint.has(fingerprint)) {
          byFingerprint.set(fingerprint, [])
        }
        byFingerprint.get(fingerprint).push({ id: event.tool_use_id, hasErrorResult })
      }
    }
  }

  // Hide errored attempts that have a later same-fingerprint sibling
  for (const group of byFingerprint.values()) {
    if (group.length <= 1) {
      continue
    }
    for (let i = 0; i < group.length - 1; i++) {
      if (group[i].hasErrorResult) {
        ids.add(group[i].id)
      }
    }
  }

  return ids
}

/**
 * Extract MCP servers from init events.
 */
export function getMcpServers(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === EventType.SYSTEM && e.subtype === EventSubtype.INIT) {
      return e.message_data?.mcp_servers || []
    }
  }
  return []
}

// Private helpers
// ------------------------------------------------------------------------

/** Parse XML notification tags from content and add to notifications map. */
function _parseNotificationTags(content, tagName, notifications) {
  const pattern = new RegExp(
    `<${tagName}\\s+task_id="([^"]+)"\\s+status="([^"]+)">([\\s\\S]*?)<\\/${tagName}>`,
    'g',
  )
  for (const match of content.matchAll(pattern)) {
    const [, taskId, status, fullContent] = match
    const trimmed = fullContent.trim()
    notifications.set(taskId, {
      status,
      summary: trimmed.split('\n')[0] || status,
      content: trimmed,
    })
  }
}

/** Extract task_id values from notification XML tags in content. */
function _extractNotificationTaskIds(content) {
  const ids = []
  for (const match of content.matchAll(NOTIFICATION_TASK_ID_PATTERN)) {
    ids.push(match[1])
  }
  return ids
}

/** Create a turn object. */
function createTurn(turn_id, userMessage, events, attachments = null) {
  return {
    turn_id,
    userMessage,
    events,
    settingChanges: [],
    interrupted: false,
    attachments,
  }
}

/** Compute diff between previous and current todo states. */
function computeSingleDiff(previousTodos, currentTodos) {
  const prevByContent = new Map(previousTodos.map(t => [t.content, t]))
  const currByContent = new Map(currentTodos.map(t => [t.content, t]))

  const completed = []
  const started = []
  const added = []
  const removed = []

  for (const curr of currentTodos) {
    const prev = prevByContent.get(curr.content)

    if (!prev) {
      // New item - categorize by status
      if (curr.status === TodoStatus.COMPLETED) {
        completed.push(curr)
      } else if (curr.status === TodoStatus.IN_PROGRESS) {
        started.push(curr)
      } else {
        added.push(curr)
      }
    } else if (prev.status !== curr.status) {
      // Status changed
      if (curr.status === TodoStatus.COMPLETED) {
        completed.push(curr)
      } else if (curr.status === TodoStatus.IN_PROGRESS) {
        started.push(curr)
      }
    }
  }

  // Track removed items
  for (const prev of previousTodos) {
    if (!currByContent.has(prev.content)) {
      removed.push(prev)
    }
  }

  return { completed, started, added, removed }
}

/**
 * Resolve async task_ids from an event into tool_use_ids via the asyncMap.
 * Returns array of tool_use_ids that should be cleaned up from the subagent todo map.
 */
function _resolveAsyncTaskIds(event, asyncMap) {
  if (event.type === EventType.SYSTEM && event.subtype === EventSubtype.TASK_NOTIFICATION) {
    const taskId = event.message_data?.task_id
    const toolUseId = taskId && asyncMap.get(taskId)
    return toolUseId ? [toolUseId] : []
  }
  if (
    event.type === EventType.USER &&
    !event.is_human &&
    event.subtype === EventSubtype.TEXT &&
    event.content
  ) {
    const ids = []
    for (const taskId of _extractNotificationTaskIds(event.content)) {
      const toolUseId = asyncMap.get(taskId)
      if (toolUseId) {
        ids.push(toolUseId)
      }
    }
    return ids
  }
  return []
}

/** Build map of parent_tool_use_id → max event timestamp for staleness tracking. */
function buildLastEventTimeMap(events) {
  const map = new Map()
  for (const event of events) {
    const parentId = event.parent_tool_use_id
    if (parentId) {
      const eventTime = event.ts ? new Date(event.ts).getTime() : event.timestamp
      if (eventTime) {
        const prev = map.get(parentId) || 0
        if (eventTime > prev) {
          map.set(parentId, eventTime)
        }
      }
    }
  }
  return map
}

/** True when the event is a setting-change divider or a container-restart divider. */
function isSettingChangeOrRestart(event) {
  return event.type === EventType.SYSTEM && SETTING_CHANGE_SUBTYPES.has(event.subtype)
}

/** True when the setting-change event represents the session's initial value (no previous). */
function isSettingInit(event) {
  if (event.subtype === EventSubtype.MODEL_CHANGED) {
    return event.previous_model == null
  }
  if (event.subtype === EventSubtype.PERMISSION_MODE_CHANGED) {
    return event.previous_permission_mode == null
  }
  if (event.subtype === EventSubtype.EFFORT_LEVEL_CHANGED) {
    return event.previous_effort_level == null
  }
  return false
}
