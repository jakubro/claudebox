/** Pure derivations for the terminal column - session-wide top-level Bash call/result pairing. */

import { normalizeToolName, ToolName } from '../../../config/schema'
import { isHumanEvent } from '../../../utils/eventPredicates'
import { indexEvents } from '../../../utils/eventProcessing'

/**
 * Top-level Bash calls paired with their results, in arrival order; pairing from `indexEvents`.
 * Nested (subagent) and non-Bash calls are excluded, as `groupBlocks`'s `hideShellCalls` does.
 * A tool_use carries no `turn_id` - only the turn-opening human event does - so the most recent
 * human `turn_id` applies to every following event.
 */
export function deriveTerminalEntries(events) {
  const { toolResults } = indexEvents(events)
  const entries = []
  let currentTurnId = null

  for (const event of events) {
    if (isHumanEvent(event) && !event.parent_tool_use_id) {
      currentTurnId = event.turn_id ?? null
    }

    if (event.subtype !== 'tool_use') {
      continue
    }
    if (event.parent_tool_use_id) {
      continue
    }
    if (normalizeToolName(event.content) !== ToolName.BASH) {
      continue
    }
    entries.push({
      id: event.tool_use_id,
      turnId: currentTurnId,
      // || not ?? - LangGraph sends an empty string, not undefined, for a missing description.
      description: event.tool_input?.description || null,
      command: event.tool_input?.command ?? '',
      result: toolResults.get(event.tool_use_id) ?? null,
    })
  }

  return entries
}
