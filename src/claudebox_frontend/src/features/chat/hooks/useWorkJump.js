/** Step navigation between turns in the work column. */

import { turnHasWorkPanelContent } from '../utils/predictWorkEntryHeight'
import useColumnStep from './useColumnStep'

/**
 * Provide step navigation between the work column's turn entries, skipping any turn that routed
 * nothing away - the virtualizer indexes every turn, but only working ones have a row to land on.
 *
 * @param {object} containerRef - Ref to the work column's scroll container.
 * @param {object} virtualizerRef - Ref holding the work virtualizer.
 * @param {Array} turns - The same turn list the column renders, so `isTargetable` can resolve an
 *   index back to its turn.
 * @param {string} mode - TurnRoutingMode; ALL_TOOLS whenever the work column is mounted.
 * @param {function} [markProgrammaticScroll] - Brackets scroll writes against the intent latch.
 * @param {function} [markUserIntent] - Fired before an off-bottom step.
 * @param {function} [markReturnedToBottom] - Fired before an at-bottom step.
 */
export default function useWorkJump({
  containerRef,
  virtualizerRef,
  turns,
  mode,
  markProgrammaticScroll,
  markUserIntent,
  markReturnedToBottom,
}) {
  const { stepPrev, stepNext } = useColumnStep({
    containerRef,
    virtualizerRef,
    markProgrammaticScroll,
    markUserIntent,
    markReturnedToBottom,
    rowSelector: '.work-row',
    // The work column renders no entry outside its own window - the active turn is just the last
    // windowed target, not a separate always-mounted element like the terminal's trailing entry.
    resolveTrailingEl: () => null,
    isTargetable: index => turnHasWorkPanelContent(turns[index], mode),
  })

  return { stepPrev, stepNext }
}
