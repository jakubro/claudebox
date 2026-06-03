/** Custom dnd-kit collision detection that prefers ticket droppables over their containing cells. */

import { pointerWithin, rectIntersection } from '@dnd-kit/core'

/**
 * Prefer ticket droppables over their containing cells when resolving collisions.
 *
 * Tickets are SortableContext children fully contained within cell droppables;
 * default rectIntersection / closestCenter tie-break to the cell because nested
 * rects produce equal scores. Ticket IDs are file paths (no `:`); cell/header
 * IDs always contain `:`.
 *
 * @param {object} args - dnd-kit CollisionDetection args.
 * @returns {Array} Filtered collision candidates.
 */
export function preferTicketCollisions(args) {
  const pointerHits = pointerWithin(args)
  const ticketHits = pointerHits.filter(c => !String(c.id).includes(':'))
  if (ticketHits.length > 0) {
    return ticketHits
  }
  return rectIntersection(args)
}
