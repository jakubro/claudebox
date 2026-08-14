/** Bring a windowed-out turn into the DOM so it can be scrolled to. */

/** Frames to keep looking for a turn after asking the virtualizer for it. */
export const MOUNT_FRAMES = 12

/**
 * Ensure a turn is mounted, then hand its element to `onResolved`.
 *
 * A windowed-out turn has no DOM element, so a plain `querySelector` finds nothing; this asks the
 * virtualizer to scroll its index into range, then polls for the element to appear.
 *
 * Polls instead of counting frames: `scrollToIndex` only schedules the scroll, and the turn mounts
 * on whichever later frame the virtualizer settles on - callers get `onResolved(null)` if it never does.
 *
 * @param {object} params
 * @param {string} params.turnId - Target turn.
 * @param {Array} params.turns - Historical turns, in virtualizer index order.
 * @param {object} params.virtualizer - Virtualizer instance, or null.
 * @param {Function} params.onResolved - Receives the turn element (or null).
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

/**
 * Locate a mounted windowed row by its virtual index.
 *
 * Preferred over the turn id wherever an index is already in hand: a turn only carries `data-turn-id`
 * when the transcript gave it one, and older sessions routinely have turns without.
 */
export function findTurnRow(index) {
  return document.querySelector(`.historical-turn-row[data-index="${index}"]`)
}

/**
 * Call `resolve` each frame until it returns something, then hand it over.
 *
 * Gives up after `frames` attempts and reports null, so a caller never waits forever on an absent turn.
 */
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
