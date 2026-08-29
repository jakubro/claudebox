/** Content-derived per-turn-entry height predictor for the work panel's virtualizer. */

import {
  AVG_CHAR_WIDTH_PX,
  LINE_HEIGHT_PX,
  PX_PER_BASH_TOOL_BLOCK,
  PX_PER_TOOL_BLOCK,
  WORK_ENTRY_MIN_PREDICTED_HEIGHT_PX,
  WORK_ENTRY_SEPARATOR_HEIGHT_PX,
} from '../../../config/dimensions'
import { normalizeToolName } from '../../../config/schema'
import {
  blockRoutesToRightSlot,
  isHiddenToolSearch,
  isTopLevelBashCall,
  TurnRoutingMode,
} from '../../../utils/eventProcessing'
import { buildToolHeader } from '../components/turn/components/tool-block/utils/toolResultFormatters'

/**
 * Per-turn-entry rendered height in the work panel, walking `turn.events` directly so a windowed-
 * out turn costs no block build. Width-dependent, since tool blocks wrap; zero means no entry.
 *
 * @param {object} [cacheRef] - Optional `{current: Map}` keyed by `turn_id`, shared with the
 *   overview's bar builder. Callers must withhold it for the still-growing active turn.
 */
export function predictWorkEntryHeight(
  turn,
  effectiveWidth,
  mode = TurnRoutingMode.OFF,
  cacheRef = null,
) {
  if (!turn) {
    return 0
  }

  const cacheKey = turn.turn_id
  if (cacheRef && cacheKey != null) {
    const cached = cacheRef.current.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const charsPerLine = Math.max(20, Math.floor(effectiveWidth / AVG_CHAR_WIDTH_PX))
  const toolResultsByUseId = new Map()
  for (const event of turn.events || []) {
    if (event.subtype === 'tool_result' && event.tool_use_id) {
      toolResultsByUseId.set(event.tool_use_id, event)
    }
  }

  let hasContent = false
  let blocksHeight = 0

  for (const event of turn.events || []) {
    if (event.subtype === 'tool_use') {
      const result = toolResultsByUseId.get(event.tool_use_id)
      if (isHiddenToolSearch(event, result) || !blockRoutesToRightSlot(mode, event)) {
        continue
      }
      hasContent = true
      const header = buildToolHeader(normalizeToolName(event.content), event.tool_input ?? {}) || ''
      const headerLines = Math.max(1, Math.ceil(header.length / charsPerLine))
      const base = isTopLevelBashCall(event) ? PX_PER_BASH_TOOL_BLOCK : PX_PER_TOOL_BLOCK
      blocksHeight += base + (headerLines - 1) * LINE_HEIGHT_PX
    } else if (event.subtype === 'compact_start' || event.subtype === 'compact_boundary') {
      hasContent = true
    }
  }

  const height = hasContent
    ? Math.max(WORK_ENTRY_MIN_PREDICTED_HEIGHT_PX, WORK_ENTRY_SEPARATOR_HEIGHT_PX + blocksHeight)
    : 0

  if (cacheRef && cacheKey != null) {
    cacheRef.current.set(cacheKey, height)
  }

  return height
}

/**
 * Cheap membership test the panel entry and the empty-state check share: does this turn route
 * anything to the panel, or hold a compaction. The same walk, without the height math.
 */
export function turnHasWorkPanelContent(turn, mode = TurnRoutingMode.OFF) {
  for (const event of turn?.events || []) {
    if (event.subtype === 'compact_start' || event.subtype === 'compact_boundary') {
      return true
    }
    if (event.subtype !== 'tool_use') {
      continue
    }
    if (!blockRoutesToRightSlot(mode, event)) {
      continue
    }
    // A hidden ToolSearch never lands anywhere - check last since it needs the paired result.
    const result = (turn.events || []).find(
      e => e.subtype === 'tool_result' && e.tool_use_id === event.tool_use_id,
    )
    if (!isHiddenToolSearch(event, result)) {
      return true
    }
  }
  return false
}

/** Whether any turn in the session has ever routed something to the work panel. */
export function hasAnyWorkPanelContent(turns, mode = TurnRoutingMode.OFF) {
  return turns.some(turn => turnHasWorkPanelContent(turn, mode))
}
