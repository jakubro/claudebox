/** Partition turn blocks into singletons, grouped Todos runs, and a gathered Lookups group. */

import { isLookupsGroupingEnabled } from '../../../../../config/features'
import { BlockType, normalizeToolName, ToolName } from '../../../../../config/schema'
import { getToolConfig } from '../../../../../config/toolRegistry'
import { isHiddenToolSearch } from '../../../../../utils/eventProcessing'

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
 * Partitions blocks into segments: consecutive task-list tool blocks within one subagent
 * partition form a `'todos-group'`, unless the run is inspection-only (TaskList/TaskGet with no
 * mutation), which demotes to per-block `'single'` segments. A second pass then gathers every
 * read-only `'single'` into one trailing `'lookups-group'` (see `gatherLookups`). Tool names are
 * normalised so LangGraph's snake_case names classify like their PascalCase equivalents.
 *
 * @param {Array<object>} blocks - Processed event blocks (TurnBlockList input).
 * @returns {Array<{kind: 'single', block: object, index: number} | {kind: 'todos-group', blocks: Array<object>} | {kind: 'lookups-group', entries: Array<object>}>}
 */
export function groupBlocks(blocks) {
  const segments = []
  let run = null
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type === BlockType.TOOL && isHiddenToolSearch(block.toolUse, block.toolResult)) {
      continue
    }
    const tu = block.type === BlockType.TOOL ? block.toolUse : null
    const toolName = tu ? normalizeToolName(tu.content) : null
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

/**
 * Flushes a run: emits a `'todos-group'` if it contains a mutation, else demotes each
 * block to `'single'` so inspection-only payloads stay visible.
 */
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
 * Second pass: gathers every read-only `'single'` segment into a trailing `'lookups-group'`,
 * preserving call order (segments already in a `'todos-group'` aren't candidates). Returns
 * `segments` unchanged below a two-entry threshold.
 *
 * @param {Array<object>} segments - Output of the positional pass above.
 * @returns {Array<object>}
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
