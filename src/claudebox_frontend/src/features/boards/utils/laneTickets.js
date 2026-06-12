/** Pure swimlane filter - extracted from SwimlaneBand.jsx, no React APIs. */

/**
 * Collect all tickets in a swimlane across every column.
 *
 * The unsorted catch-all lane sweeps any ticket whose swimlane is not in the
 * known swimlane id list (or is missing).
 *
 * @param {Object<string, Array<{swimlane?: string}>>} allTickets - Columns keyed by column id.
 * @param {string} laneId - The swimlane id this band represents.
 * @param {boolean} isUnsorted - Whether this band is the catch-all lane.
 * @param {string[] | undefined} swimlaneIds - All known swimlane ids (used by the catch-all branch).
 * @returns {Array<{swimlane?: string}>}
 */
export function getLaneTickets(allTickets, laneId, isUnsorted, swimlaneIds) {
  if (!allTickets) {
    return []
  }
  const tickets = []
  for (const colTickets of Object.values(allTickets)) {
    for (const t of colTickets) {
      if (isUnsorted) {
        if (!(t.swimlane && swimlaneIds?.includes(t.swimlane))) {
          tickets.push(t)
        }
      } else if (t.swimlane === laneId) {
        tickets.push(t)
      }
    }
  }
  return tickets
}
