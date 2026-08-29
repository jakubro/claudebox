/** Render the block list for a conversation turn. */

import { useTurnRoutingMode } from '../hooks/useTurnRoutingMode'
import { groupBlocks } from '../utils/groupBlocks'
import TurnSegments from './TurnSegments'

/**
 * Dispatches each transcript-side segment to its renderer via `TurnSegments`. The segments this
 * turn routed away render in the work panel's entry, through the same dispatch.
 * @param {Set} [props.duplicateAskUserIds] - Cross-turn duplicate AskUserQuestion IDs to hide.
 */
export default function TurnBlockList({
  blocks,
  blockOffsets,
  duplicateAskUserIds = null,
  todoDiffs = null,
}) {
  const routingMode = useTurnRoutingMode()
  const { transcript } = groupBlocks(blocks, routingMode)
  return (
    <TurnSegments
      segments={transcript}
      blockOffsets={blockOffsets}
      duplicateAskUserIds={duplicateAskUserIds}
      todoDiffs={todoDiffs}
    />
  )
}
