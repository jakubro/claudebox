/** Step navigation between entries in the terminal column. */

import useColumnStep from './useColumnStep'

/**
 * Step navigation between the terminal column's entries: `useColumnStep` with the terminal's row
 * selector and trailing-element resolver. No top/bottom control - `scrollHeight` is an estimate.
 *
 * @param {object} containerRef - Ref to the terminal's scroll container.
 * @param {object} virtualizerRef - Ref holding the terminal virtualizer.
 * @param {object} trailingEntryRef - Ref to the trailing (newest) entry's element.
 * @param {function} [markProgrammaticScroll] - Brackets scroll writes so they do not raise
 *   user-intent in the terminal's own scroll handler.
 * @param {function} [markUserIntent] - Fired before an off-bottom step.
 * @param {function} [markReturnedToBottom] - Fired before an at-bottom step.
 */
export default function useTerminalJump({
  containerRef,
  virtualizerRef,
  trailingEntryRef,
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
    rowSelector: '.terminal-entry',
    resolveTrailingEl: () => trailingEntryRef.current,
  })

  return { stepPrev, stepNext }
}
