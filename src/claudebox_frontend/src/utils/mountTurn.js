/** Bring a windowed-out turn into the DOM so it can be scrolled to. */

/** Frames to keep looking for a turn after asking the virtualizer for it. */
export const MOUNT_FRAMES = 12

/**
 * Ensure a turn is mounted, then hand its element to `onResolved` - null if it never mounts.
 *
 * A windowed-out turn has no DOM element, so this scrolls its index into range first, then polls:
 * `scrollToIndex` only schedules the scroll, so the mount lands on an unpredictable later frame.
 * `turns` is in virtualizer index order; `virtualizer` may be null.
 *
 * `root` scopes the lookup to one rail group: `data-index` and `data-turn-id` are not unique
 * document-wide, so an unscoped query finds the leftmost group's match instead.
 */
export function withMountedTurn({ turnId, turns, virtualizer, onResolved, root }) {
  const existing = findTurnEl(turnId, root)
  if (existing) {
    onResolved(existing)
    return
  }

  const index = turns.findIndex(t => t.turn_id === turnId)
  if (index < 0 || !virtualizer) {
    onResolved(null)
    return
  }

  virtualizer.scrollToIndex(index, { align: 'start' })
  pollFrames(MOUNT_FRAMES, () => findTurnEl(turnId, root), onResolved)
}

/**
 * Locate a mounted turn element by id, scoped to `root` (see withMountedTurn), which falls back to
 * `document` on a missing argument and on `null`, as an unattached ref reads.
 */
export function findTurnEl(turnId, root) {
  return (root || document).querySelector(`[data-turn-id="${CSS.escape(String(turnId))}"]`)
}

/**
 * Locate a windowed row by index - preferred over an id, which older turns lack, and the only
 * option for a column whose entries carry none. `rowSelector` is the row's own class.
 */
export function findTurnRow(index, rowSelector = '.historical-turn-row', root) {
  return (root || document).querySelector(`${rowSelector}[data-index="${index}"]`)
}

/** Call `resolve` each frame until it returns something; reports null after `frames` attempts. */
export function pollFrames(frames, resolve, onResolved) {
  const found = resolve()
  if (found) {
    onResolved(found)
    return
  }
  if (frames <= 0) {
    onResolved(null)
    return
  }
  requestAnimationFrame(() => pollFrames(frames - 1, resolve, onResolved))
}
