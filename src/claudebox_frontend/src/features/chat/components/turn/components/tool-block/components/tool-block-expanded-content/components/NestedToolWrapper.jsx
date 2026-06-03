/** Wrapper for nested ToolBlock rendering. */

import { useTurn } from '../../../../../hooks/useTurn'
import ToolBlock from '../../../ToolBlock'

/**
 * Render a ToolBlock in nested context (e.g., inside Task output).
 * Consumes TurnContext for todoDiffs.
 * @param {Object} props
 * @param {Object} props.toolUse - Tool invocation data.
 * @param {Object} props.toolResult - Tool result data.
 * @param {number} [props.blockRelativeTime] - Precomputed offset from turn start in seconds.
 */
export default function NestedToolWrapper({ toolUse, toolResult, blockRelativeTime = null }) {
  const { todoDiffs } = useTurn()

  const toolUseId = toolUse?.tool_use_id
  const todoDiff = toolUseId && todoDiffs ? todoDiffs.get(toolUseId) : null

  return (
    <ToolBlock
      toolUse={toolUse}
      toolResult={toolResult}
      nested
      todoDiff={todoDiff}
      blockRelativeTime={blockRelativeTime}
    />
  )
}
