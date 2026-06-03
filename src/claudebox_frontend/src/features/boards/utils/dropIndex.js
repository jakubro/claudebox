/** Translate a visual drop slot in a swimlane-filtered cell to a flat YAML index. */

/**
 * Compute the flat-list index where a ticket should be inserted, given a drop
 * target ticket path and the swimlane currently filtering the rendered cell.
 *
 * Per-state YAML lists intermix swimlanes; the rendered cell is the per-lane
 * filtered subset. The visual slot above the drop-target ticket maps to the
 * absolute index in the unfiltered list right at that lane match.
 *
 * @param {Array} unfilteredColumn - Tickets in the target state's flat list.
 * @param {string} targetSwimlane - Lane id ('__unsorted__' for unsorted).
 * @param {string} overTicketPath - Path of the ticket being dropped onto.
 * @returns {number|null} Flat-list index, or null if overTicketPath isn't found.
 */
export function computeFlatDropIndex(unfilteredColumn, targetSwimlane, overTicketPath) {
  const filtered = unfilteredColumn.filter(t => (t.swimlane || '__unsorted__') === targetSwimlane)
  const visualSlot = filtered.findIndex(t => t.path === overTicketPath)
  if (visualSlot === -1) {
    return null
  }
  let count = 0
  for (let i = 0; i < unfilteredColumn.length; i++) {
    if ((unfilteredColumn[i].swimlane || '__unsorted__') === targetSwimlane) {
      if (count === visualSlot) {
        return i
      }
      count++
    }
  }
  return unfilteredColumn.length
}

/**
 * Detect a self-drop no-op — dropping a ticket onto its own current path.
 *
 * @param {string} sourceTicketPath
 * @param {string} overTicketPath
 * @returns {boolean}
 */
export function isSelfDrop(sourceTicketPath, overTicketPath) {
  return sourceTicketPath === overTicketPath
}
