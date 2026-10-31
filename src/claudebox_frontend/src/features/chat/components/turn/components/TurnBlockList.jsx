/** Render the block list for a conversation turn. */

import { useFocusedMarks } from '../hooks/useFocusedMarks'
import { useTurnRoutingMode } from '../hooks/useTurnRoutingMode'
import { groupBlocks } from '../utils/groupBlocks'
import TurnSegments from './TurnSegments'

/**
 * Dispatches each transcript-side segment to its renderer via `TurnSegments`. The segments this
 * turn routed away render in the work panel's entry, through the same dispatch.
 * @param {Set} [props.duplicateAskUserIds] - Cross-turn duplicate AskUserQuestion IDs to hide.
 * @param {Set<string>} [props.bookmarkedParts] - Bookmark tails; a bookmarked call always shows.
 */
export default function TurnBlockList({
  blocks,
  blockOffsets,
  duplicateAskUserIds = null,
  todoDiffs = null,
  bookmarkedParts = null,
}) {
  const routingMode = useTurnRoutingMode()
  const { isMarked } = useFocusedMarks()
  const { transcript } = groupBlocks(blocks, routingMode, bookmarkedParts, isMarked)
  return (
    <TurnSegments
      segments={transcript}
      blockOffsets={blockOffsets}
      duplicateAskUserIds={duplicateAskUserIds}
      todoDiffs={todoDiffs}
    />
  )
}
