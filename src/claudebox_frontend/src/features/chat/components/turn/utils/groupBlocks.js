/** Partition turn blocks into singletons, grouped Todos runs, and a gathered Lookups group. */

import { isLookupsGroupingEnabled } from '../../../../../config/features'
import { BlockType, normalizeToolName, ToolName } from '../../../../../config/schema'
import { getToolConfig } from '../../../../../config/toolRegistry'
import { isHiddenToolSearch, isTopLevelBashCall } from '../../../../../utils/eventProcessing'

// Task-list families in the grouped Todos run; TaskOutput and the bare Task tool are excluded
// so they render as ordinary blocks and break the run.
const TASK_LIST_TOOLS = new Set([
  ToolName.TASK_CREATE,
  ToolName.TASK_UPDATE,
  ToolName.TASK_LIST,
  ToolName.TASK_GET,
])

// Mutation tools that make a run render as the grouped Todos view; inspection-only runs
// (TaskList/TaskGet, no mutation) demote to per-block singles.
const TASK_MUTATION_TOOLS = new Set([ToolName.TASK_CREATE, ToolName.TASK_UPDATE])

/**
 * Consecutive task-list blocks in one subagent partition form a `'todos-group'`, unless the run is
 * inspection-only (TaskList/TaskGet, no mutation). `gatherLookups` then pools read-only singles.
 * `hideShellCalls` drops top-level Bash blocks - they render in the terminal column instead.
 */
export function groupBlocks(blocks, hideShellCalls = false) {
  const segments = []
  let run = null
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type === BlockType.TOOL && isHiddenToolSearch(block.toolUse, block.toolResult)) {
      continue
    }
    const tu = block.type === BlockType.TOOL ? block.toolUse : null
    const toolName = tu ? normalizeToolName(tu.content) : null
    if (hideShellCalls && tu && isTopLevelBashCall(tu)) {
      continue
    }
    const isListTool = !!tu && TASK_LIST_TOOLS.has(toolName)
    if (isListTool) {
      const partition = tu.parent_tool_use_id ?? null
      if (run && run.partition === partition) {
        run.entries.push({ block, index: i })
        continue
      }
      // New run - flush any prior run before starting.
      if (run) {
        flushRun(run, segments)
      }
      run = { partition, entries: [{ block, index: i }] }
      continue
    }
    if (run) {
      flushRun(run, segments)
      run = null
    }
    segments.push({ kind: 'single', block, index: i })
  }
  if (run) {
    flushRun(run, segments)
  }
  return gatherLookups(segments)
}

/** A run with a mutation emits `'todos-group'`; otherwise singles, keeping payloads visible. */
function flushRun(run, segments) {
  if (run.entries.some(e => isMutation(e.block))) {
    segments.push({ kind: 'todos-group', blocks: run.entries.map(e => e.block) })
    return
  }
  for (const { block, index } of run.entries) {
    segments.push({ kind: 'single', block, index })
  }
}

function isMutation(block) {
  return TASK_MUTATION_TOOLS.has(normalizeToolName(block.toolUse?.content))
}

/**
 * Pools read-only `'single'` segments into a trailing `'lookups-group'`, preserving call order.
 * Segments already inside a `'todos-group'` are not candidates.
 */
function gatherLookups(segments) {
  if (!isLookupsGroupingEnabled()) {
    return segments
  }

  const kept = []
  const lookups = []
  for (const segment of segments) {
    const isReadOnlySingle =
      segment.kind === 'single' &&
      segment.block.type === BlockType.TOOL &&
      getToolConfig(segment.block.toolUse?.content).category === 'read-only'
    if (isReadOnlySingle) {
      lookups.push(segment)
    } else {
      kept.push(segment)
    }
  }
  if (lookups.length < 2) {
    return segments
  }
  return [...kept, { kind: 'lookups-group', entries: lookups }]
}
