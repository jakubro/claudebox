/** Per-turn heights for the minimap, derived from the content predictor. */

import { useCallback, useMemo } from 'react'
import { TURN_HORIZONTAL_PADDING_PX } from '../../../config/dimensions'
import { predictTurnHeight, predictUserMessageHeight } from '../utils/predictTurnHeight'

const EMPTY_SET = new Set()

/**
 * Return per-turn heights and a scroll-axis total for the minimap.
 *
 * Every turn is priced by `predictTurnHeight`, the same content-derived estimator the virtualizer
 * uses, calibrated against fixtures by `e2e/app/tests/predictor-calibration.spec.js` (drift under
 * 30%).
 *
 * Deliberately NOT sourced from real measurements: with the list windowed, only a handful of turns
 * have a height at any moment, and feeding those back into state re-renders the list, which mounts
 * and measures more turns, which publishes again - a cycle that never settles and that React aborts
 * outright on a long transcript. Predictions are stable, complete, and independent of what's on
 * screen, so the minimap stops depending on scroll history for its proportions.
 *
 * @param {object} messagesRef - Ref to the chat scroll container.
 * @param {Array} turns - All turns, active one included.
 * @param {Set} [collapsedTurnIds] - Turn ids currently collapsed.
 * @returns {{turnHeights: object, userMessageHeights: object, getLogicalScrollHeight: Function}}
 */
export default function useTurnHeights(messagesRef, turns, collapsedTurnIds = EMPTY_SET) {
  const effectiveWidth = Math.max(
    0,
    (messagesRef?.current?.clientWidth || 0) - TURN_HORIZONTAL_PADDING_PX,
  )

  const turnHeights = useMemo(() => {
    const out = {}
    for (const turn of turns) {
      const id = turn?.turn_id
      if (id) {
        out[id] = predictTurnHeight(turn, effectiveWidth, collapsedTurnIds.has(id))
      }
    }
    return out
  }, [turns, effectiveWidth, collapsedTurnIds])

  // Predicted for the same reason as turnHeights: a windowed-out turn has no element to measure,
  // and measuring only the mounted few would flatten the rest.
  const userMessageHeights = useMemo(() => {
    const out = {}
    for (const turn of turns) {
      const id = turn?.turn_id
      if (id) {
        out[id] = predictUserMessageHeight(turn, effectiveWidth)
      }
    }
    return out
  }, [turns, effectiveWidth])

  const getLogicalScrollHeight = useCallback(
    () => Object.values(turnHeights).reduce((sum, h) => sum + h, 0),
    [turnHeights],
  )

  return { turnHeights, userMessageHeights, getLogicalScrollHeight }
}
