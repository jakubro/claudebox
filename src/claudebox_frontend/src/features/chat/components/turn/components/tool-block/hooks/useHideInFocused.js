/** Hide-from-Focused control for a connected tool server's call, or null where none applies. */

import { isHiddenTool, mcpToolOf, normalizeToolName } from '../../../../../../../config/schema'
import { FOCUSED_HIDDEN_TOOLS } from '../../../../../../../config/toolRegistry'
import { useOptionalFocusedHiddenTools } from '../../../../../../../context/FocusedHiddenToolsContext'
import { useFocusedMarks } from '../../../hooks/useFocusedMarks'

/**
 * None for a call Focused already hides on its own - by name or by its server's read-only flag -
 * nor on a phone. A subagent's call gets one too: a mark names a tool, not a call.
 * @param {object} toolUse - The call's tool_use event
 * @returns {{active: boolean, onToggle: function}|null}
 */
export default function useHideInFocused(toolUse) {
  const marks = useOptionalFocusedHiddenTools()
  const { runtimeName, canMark } = useFocusedMarks()
  const name = toolUse?.content
  if (
    !(marks && canMark) ||
    toolUse?.mcp_read_only === true ||
    FOCUSED_HIDDEN_TOOLS.has(normalizeToolName(name)) ||
    !mcpToolOf(name, runtimeName)
  ) {
    return null
  }
  const matching = [...marks.hiddenTools].filter(mark =>
    isHiddenTool(name, runtimeName, new Set([mark])),
  )
  return {
    active: matching.length > 0,
    onToggle: () =>
      matching.length ? marks.unmarkTools(matching) : marks.markTool(normalizeToolName(name)),
  }
}
