/** Build the work overview's bars - one per working turn, by content, duration and status. */

import { normalizeToolName } from '../../../config/schema'
import { blockRoutesToRightSlot, isHiddenToolSearch } from '../../../utils/eventProcessing'
import { extractToolResult } from '../components/turn/components/tool-block/utils/toolResultFormatters'
import { getTurnTimeRange } from '../components/turn/utils/turnContent'
import { normalizeWidths } from './normalizeMinimapWidths'
import { predictWorkEntryHeight, turnHasWorkPanelContent } from './predictWorkEntryHeight'

/**
 * 'running' while any routed call has no result yet, else 'failed' when any did, else 'passed'.
 * Failure comes from `extractToolResult`, the same function the block renders its marking from.
 */
function turnCallStatus(turn, mode) {
  const toolResultsByUseId = new Map()
  for (const event of turn.events || []) {
    if (event.subtype === 'tool_result' && event.tool_use_id) {
      toolResultsByUseId.set(event.tool_use_id, event)
    }
  }

  let anyFailed = false
  for (const event of turn.events || []) {
    if (event.subtype !== 'tool_use') {
      continue
    }
    const result = toolResultsByUseId.get(event.tool_use_id)
    if (!blockRoutesToRightSlot(mode, event)) {
      continue
    }
    if (!result) {
      return 'running'
    }
    if (isHiddenToolSearch(event, result)) {
      continue
    }
    const { isError } = extractToolResult(
      normalizeToolName(event.content),
      event.tool_input ?? {},
      result.content || '',
    )
    if (isError) {
      anyFailed = true
    }
  }
  return anyFailed ? 'failed' : 'passed'
}

/**
 * One bar per turn that routed something away, oldest first: `height` from the virtualizer's own
 * `predictWorkEntryHeight`, `width` from the turn's span, `status` from its calls.
 *
 * @param {Array} turns - Every turn, oldest first; a turn routing nothing away gets no bar.
 * @param {number} effectiveWidth - Column content width, for the wrap-aware height prediction.
 * @param {string} mode - TurnRoutingMode; ALL_TOOLS whenever the work column is mounted.
 * @param {object} cacheRef - Shared with `useWorkPanelVirtualizer`; withheld for the trailing turn.
 */
export function buildWorkMinimapBars(turns, effectiveWidth, mode, cacheRef) {
  const bars = []
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    if (!turnHasWorkPanelContent(turn, mode)) {
      continue
    }
    const isTrailing = i === turns.length - 1
    const height = predictWorkEntryHeight(turn, effectiveWidth, mode, isTrailing ? null : cacheRef)
    const { startTime, endTime } = getTurnTimeRange(turn.events || [])
    bars.push({
      id: turn.turn_id ?? i,
      height,
      duration: startTime != null && endTime != null ? endTime - startTime : null,
      status: turnCallStatus(turn, mode),
    })
  }

  const [normalized] = normalizeWidths([{ turns: bars }])
  return normalized.turns
}
