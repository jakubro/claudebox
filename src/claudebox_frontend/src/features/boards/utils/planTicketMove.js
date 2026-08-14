/** Decision logic for bulk ticket moves - pure, no React APIs. */

/**
 * Decide what move-API body to send for a single ticket within a bulk move.
 *
 * Returns null when the ticket is already at the destination (no-op skip). `advanceIndex`
 * tells the caller to bump nextIndex for the next same-lane ticket so bulk drops land sequentially.
 *
 * @param {object} args
 * @param {object} args.ticket
 * @param {string} args.targetCol
 * @param {string|null} args.targetSwimlane
 * @param {boolean} args.isCrossLaneMove
 * @param {number|null|undefined} args.nextIndex
 * @returns {{body: object, advanceIndex: boolean} | null}
 */
export function planTicketMove({ ticket, targetCol, targetSwimlane, isCrossLaneMove, nextIndex }) {
  const colChanged = targetCol !== ticket.column
  // Lane changes only for single-lane cell drops that differ from the ticket's origin;
  // column-header drops and cross-lane bulk drops preserve per-ticket origin lane.
  const laneShouldChange =
    targetSwimlane !== null &&
    !isCrossLaneMove &&
    targetSwimlane !== (ticket.swimlane || '__unsorted__')
  const ticketLane = ticket.swimlane || '__unsorted__'
  // Index applies only when the ticket lands in the drop target's lane.
  const indexApplies =
    nextIndex !== undefined &&
    nextIndex !== null &&
    (laneShouldChange || ticketLane === targetSwimlane)
  if (!(colChanged || laneShouldChange || indexApplies)) {
    return null
  }
  return {
    body: {
      column: colChanged ? targetCol : undefined,
      swimlane: laneShouldChange && targetSwimlane !== '__unsorted__' ? targetSwimlane : undefined,
      index: indexApplies ? nextIndex : undefined,
    },
    advanceIndex: indexApplies,
  }
}
