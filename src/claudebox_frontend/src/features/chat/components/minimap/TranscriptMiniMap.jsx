/** The transcript's minimap, sized from what the transcript has measured of each turn. */

import useActiveTurnSize from '../../hooks/useActiveTurnSize'
import useTurnHeights from '../../hooks/useTurnHeights'
import MiniMap from './MiniMap'

/**
 * Owns the height lookups so a published size re-renders this subtree alone, never the chat panel.
 * @param {Array} props.turns - Every turn, active one last; other props pass to `MiniMap`.
 */
export default function TranscriptMiniMap({
  turns,
  messagesRef,
  collapsedTurnIds,
  routingMode,
  foldBoundary,
  foldExpanded,
  rowSizes,
  bookmarkedPartsOf,
  isMarked,
  ...mapProps
}) {
  const lastIndex = turns.length - 1
  useActiveTurnSize(messagesRef, turns[lastIndex]?.turn_id, lastIndex, rowSizes)
  const { turnHeights, userMessageHeights } = useTurnHeights(
    messagesRef,
    turns,
    collapsedTurnIds,
    routingMode,
    foldBoundary,
    foldExpanded,
    rowSizes,
    bookmarkedPartsOf,
    isMarked,
  )

  return (
    <MiniMap
      groups={turns}
      messagesRef={messagesRef}
      turnHeights={turnHeights}
      userMessageHeights={userMessageHeights}
      {...mapProps}
    />
  )
}
