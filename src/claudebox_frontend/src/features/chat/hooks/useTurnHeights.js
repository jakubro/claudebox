/** Per-turn heights for the minimap, derived from the content predictor. */

import { useCallback, useMemo } from 'react'
import { THREAD_FOLD_ROW_HEIGHT_PX, TURN_HORIZONTAL_PADDING_PX } from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import { predictTurnHeight, predictUserMessageHeight } from '../utils/predictTurnHeight'

const EMPTY_SET = new Set()

/**
 * Per-turn heights and a scroll-axis total for the minimap - all turns, active one included.
 * Priced by `predictTurnHeight`, the same estimator the virtualizer uses; calibrated against
 * fixtures by `e2e/app/tests/predictor-calibration.spec.js` (drift under 30%).
 *
 * Never sourced from real measurements: with the list windowed only a handful of turns have a
 * height, and publishing those re-renders the list, which mounts and measures more, which publishes
 * again - a loop that never settles and that React aborts outright on a long transcript.
 *
 * `foldBoundary`/`foldExpanded` mirror `useTurnVirtualizer`'s own fold pricing, so the minimap
 * never disagrees with the transcript about a promoted thread's folded turns.
 */
export default function useTurnHeights(
  messagesRef,
  turns,
  collapsedTurnIds = EMPTY_SET,
  mode = TurnRoutingMode.OFF,
  foldBoundary = -1,
  foldExpanded = false,
) {
  const effectiveWidth = Math.max(
    0,
    (messagesRef?.current?.clientWidth || 0) - TURN_HORIZONTAL_PADDING_PX,
  )
  const folded = foldBoundary >= 0 && !foldExpanded

  const turnHeights = useMemo(() => {
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
        out[id] = predictTurnHeight(turn, effectiveWidth, collapsedTurnIds.has(id), mode)
      }
    })
    return out
  }, [turns, effectiveWidth, collapsedTurnIds, mode, folded, foldBoundary])

  // Predicted for the same reason as turnHeights: a windowed-out turn has no element to measure,
  // and measuring only the mounted few would flatten the rest. Folded turns price at zero here
  // too - a folded human message draws nowhere, on either measurer.
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

  const getLogicalScrollHeight = useCallback(
    () => Object.values(turnHeights).reduce((sum, h) => sum + h, 0),
    [turnHeights],
  )

  return { turnHeights, userMessageHeights, getLogicalScrollHeight }
}
