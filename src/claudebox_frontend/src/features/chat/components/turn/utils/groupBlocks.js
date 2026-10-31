/** Partition turn blocks into singletons, grouped Todos runs, and a gathered Lookups group. */

import { isLookupsGroupingEnabled } from '../../../../../config/features'
import { BlockType, normalizeToolName, ToolName } from '../../../../../config/schema'
import { isReadOnlyCall } from '../../../../../config/toolRegistry'
import {
  blockRoutesToRightSlot,
  isToolBlockHidden,
  NO_TOOL_MARKED,
  TurnRoutingMode,
} from '../../../../../utils/eventProcessing'

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
 * Split a turn's blocks into the transcript's segments and the right slot's, under `mode`. Only a
 * top-level `BlockType.TOOL` block can leave, and `gatherLookups` runs on the transcript side.
 */
export function groupBlocks(
  blocks,
  mode = TurnRoutingMode.OFF,
  bookmarkedParts = null,
  isMarked = NO_TOOL_MARKED,
) {
  const isHidden = block =>
    block.type === BlockType.TOOL &&
    isToolBlockHidden(mode, block.toolUse, block.toolResult, bookmarkedParts, isMarked)
  const transcript = buildSegments(
    blocks,
    isHidden,
    tu => !(tu && blockRoutesToRightSlot(mode, tu)),
  )
  const panel = buildSegments(blocks, isHidden, tu => !!(tu && blockRoutesToRightSlot(mode, tu)))
  return { transcript: gatherLookups(transcript), panel }
}

/**
 * Move the added text of each block `mode` hides onto the nearest earlier block it keeps, or into
 * the turn's own entries when none is kept; returns new arrays, leaving the inputs untouched.
 */
export function moveHiddenInjected(
  blocks,
  injected,
  mode,
  bookmarkedParts = null,
  isMarked = NO_TOOL_MARKED,
) {
  const kept = []
  let turnInjected = injected
  for (const block of blocks) {
    const hidden =
      block.type === BlockType.TOOL &&
      isToolBlockHidden(mode, block.toolUse, block.toolResult, bookmarkedParts, isMarked)
    if (!hidden) {
      kept.push(block)
    } else if (block.injected?.length && kept.length > 0) {
      const anchor = kept[kept.length - 1]
      kept[kept.length - 1] = {
        ...anchor,
        injected: [...(anchor.injected ?? []), ...block.injected],
      }
    } else if (block.injected?.length) {
      turnInjected = [...turnInjected, ...block.injected]
    }
  }
  return { blocks: kept, injected: turnInjected }
}

/** One pass over `blocks` keeping what `belongsToThisSide` admits, with run detection. */
function buildSegments(blocks, isHidden, belongsToThisSide) {
  const segments = []
  let run = null
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (isHidden(block)) {
      continue
    }
    const tu = block.type === BlockType.TOOL ? block.toolUse : null
    if (!belongsToThisSide(tu)) {
      continue
    }
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
  return segments
}

/**
 * A run with a mutation emits `'todos-group'`; otherwise singles, keeping payloads visible.
 * `index` is the run's first entry, which the work panel's compaction merge sorts against.
 */
function flushRun(run, segments) {
  if (run.entries.some(e => isMutation(e.block))) {
    segments.push({
      kind: 'todos-group',
      blocks: run.entries.map(e => e.block),
      index: run.entries[0].index,
    })
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
      isReadOnlyCall(segment.block.toolUse, segment.block.toolResult)
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
