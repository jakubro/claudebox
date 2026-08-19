/** Per-turn heights for the minimap, derived from the content predictor. */

import { useCallback, useMemo } from 'react'
import { TURN_HORIZONTAL_PADDING_PX } from '../../../config/dimensions'
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
 */
export default function useTurnHeights(
  messagesRef,
  turns,
  collapsedTurnIds = EMPTY_SET,
  splitEnabled = false,
) {
  const effectiveWidth = Math.max(
    0,
    (messagesRef?.current?.clientWidth || 0) - TURN_HORIZONTAL_PADDING_PX,
  )

  const turnHeights = useMemo(() => {
    const out = {}
    for (const turn of turns) {
      const id = turn?.turn_id
      if (id) {
        out[id] = predictTurnHeight(turn, effectiveWidth, collapsedTurnIds.has(id), splitEnabled)
      }
    }
    return out
  }, [turns, effectiveWidth, collapsedTurnIds, splitEnabled])

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
