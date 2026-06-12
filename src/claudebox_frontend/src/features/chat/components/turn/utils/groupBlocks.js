/** Partition turn blocks into singletons + grouped runs of task-list tool blocks. */

import { BlockType, ToolName } from '../../../../../config/schema'

// Task-list tool families that participate in the grouped Todos run. TaskOutput
// + the bare `Task` tool break the run (they render as ordinary blocks).
const TASK_LIST_TOOLS = new Set([
  ToolName.TASK_CREATE,
  ToolName.TASK_UPDATE,
  ToolName.TASK_LIST,
  ToolName.TASK_GET,
])

// Mutation tools (within TASK_LIST_TOOLS) that actually produce rows in the
// grouped Todos view. A run composed entirely of inspection tools
// (TaskList / TaskGet) demotes to per-block singles so the per-block ToolBlock
// dispatch can render each inspection's payload.
const TASK_MUTATION_TOOLS = new Set([ToolName.TASK_CREATE, ToolName.TASK_UPDATE])

/**
 * Partition `blocks` into segments: single passes for non-task-list blocks +
 * grouped runs for consecutive task-list tool blocks within one subagent
 * partition. Singletons in the task-list set still render as a group when they
 * are mutations; inspection-only runs (TaskList / TaskGet without any mutation)
 * demote to per-block segments.
 *
 * @param {Array<object>} blocks - Processed event blocks (TurnBlockList input).
 * @returns {Array<{kind: 'single', block: object, index: number} | {kind: 'todos-group', blocks: Array<object>}>}
 */
export function groupBlocks(blocks) {
  const segments = []
  let run = null
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const tu = block.type === BlockType.TOOL ? block.toolUse : null
    const isListTool = !!tu && TASK_LIST_TOOLS.has(tu.content)
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
  return segments
}

/**
 * Flush an in-flight run: emit a `'todos-group'` segment when the run contains
 * at least one TaskCreate / TaskUpdate, otherwise demote each block to a
 * `'single'` segment (inspection-only runs render per-block so their payload
 * stays visible in the chat).
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
  return TASK_MUTATION_TOOLS.has(block.toolUse?.content)
}
