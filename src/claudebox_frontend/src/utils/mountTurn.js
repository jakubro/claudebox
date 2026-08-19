/** Bring a windowed-out turn into the DOM so it can be scrolled to. */

/** Frames to keep looking for a turn after asking the virtualizer for it. */
export const MOUNT_FRAMES = 12

/**
 * Ensure a turn is mounted, then hand its element to `onResolved` - null if it never mounts.
 *
 * A windowed-out turn has no DOM element, so this scrolls its index into range first, then polls:
 * `scrollToIndex` only schedules the scroll, so the mount lands on an unpredictable later frame.
 * `turns` is in virtualizer index order; `virtualizer` may be null.
 */
export function withMountedTurn({ turnId, turns, virtualizer, onResolved }) {
  const existing = findTurnEl(turnId)
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
  pollFrames(MOUNT_FRAMES, () => findTurnEl(turnId), onResolved)
}

/** Locate a mounted turn element by id. */
export function findTurnEl(turnId) {
  return document.querySelector(`[data-turn-id="${CSS.escape(String(turnId))}"]`)
}

/** Locate a windowed row by index - preferred over turn id, which older turns often lack. */
export function findTurnRow(index) {
  return document.querySelector(`.historical-turn-row[data-index="${index}"]`)
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
