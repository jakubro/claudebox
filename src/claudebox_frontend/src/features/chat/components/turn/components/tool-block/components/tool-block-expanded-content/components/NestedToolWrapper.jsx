/** Wrapper for nested ToolBlock rendering. */

import { useTurn } from '../../../../../hooks/useTurn'
import ToolBlock from '../../../ToolBlock'

/**
 * Consumes TurnContext for todoDiffs.
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
