/** Per-turn heights for the minimap - measured where the transcript knows them, else predicted. */

import { useMemo, useSyncExternalStore } from 'react'
import { THREAD_FOLD_ROW_HEIGHT_PX, TURN_HORIZONTAL_PADDING_PX } from '../../../config/dimensions'
import { NO_TOOL_MARKED, TurnRoutingMode } from '../../../utils/eventProcessing'
import { predictTurnHeight, predictUserMessageHeight } from '../utils/predictTurnHeight'

const EMPTY_SET = new Set()
const NO_SIZES = { get: () => undefined, getVersion: () => 0, subscribe: () => () => {} }

/**
 * Per-turn minimap heights: a `rowSizes` measurement where one exists, else `predictTurnHeight`.
 * Folded turns price as `useTurnVirtualizer` folds them; only the minimap may read the store.
 */
export default function useTurnHeights(
  messagesRef,
  turns,
  collapsedTurnIds = EMPTY_SET,
  mode = TurnRoutingMode.OFF,
  foldBoundary = -1,
  foldExpanded = false,
  rowSizes = NO_SIZES,
  bookmarkedPartsOf = null,
  isMarked = NO_TOOL_MARKED,
) {
  const effectiveWidth = Math.max(
    0,
    (messagesRef?.current?.clientWidth || 0) - TURN_HORIZONTAL_PADDING_PX,
  )
  const folded = foldBoundary >= 0 && !foldExpanded
  const sizesVersion = useSyncExternalStore(rowSizes.subscribe, rowSizes.getVersion)

  const predictedHeights = useMemo(() => {
    const out = {}
    turns.forEach((turn, index) => {
      const id = turn?.turn_id
      if (!id) {
        return
      }
      if (folded && index === 0) {
        out[id] = THREAD_FOLD_ROW_HEIGHT_PX
      } else if (folded && index <= foldBoundary) {
        out[id] = 0
      } else {
        out[id] = predictTurnHeight(
          turn,
          effectiveWidth,
          collapsedTurnIds.has(id),
          mode,
          bookmarkedPartsOf?.(id),
          isMarked,
        )
      }
    })
    return out
  }, [
    turns,
    effectiveWidth,
    collapsedTurnIds,
    mode,
    folded,
    foldBoundary,
    bookmarkedPartsOf,
    isMarked,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: sizesVersion is the store's change signal
  const turnHeights = useMemo(() => {
    const out = {}
    turns.forEach((turn, index) => {
      const id = turn?.turn_id
      if (!id) {
        return
      }
      const isFolded = folded && index <= foldBoundary
      out[id] = (!isFolded && rowSizes.get(id)) || predictedHeights[id]
    })
    return out
  }, [turns, predictedHeights, rowSizes, sizesVersion, folded, foldBoundary])

  // Always predicted: the transcript publishes whole-row sizes only, and a folded human message
  // draws nowhere, so it prices at zero.
  const userMessageHeights = useMemo(() => {
    const out = {}
    turns.forEach((turn, index) => {
      const id = turn?.turn_id
      if (!id) {
        return
      }
      out[id] = folded && index <= foldBoundary ? 0 : predictUserMessageHeight(turn, effectiveWidth)
    })
    return out
  }, [turns, effectiveWidth, folded, foldBoundary])

  return { turnHeights, userMessageHeights }
}
