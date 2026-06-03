/** Briefly flash a status flag for one paint cycle. */

/**
 * Flash a UI status flag long enough to be perceived after a synchronous action.
 *
 * Calls `start()` immediately, then schedules `clear()` after a double
 * requestAnimationFrame: the first frame lands after layout, the second after
 * dockview/router/etc. settle, so the flag stays visible for at least one
 * full painted frame before being cleared.
 *
 * @param {() => void} start - Set the flag.
 * @param {() => void} clear - Unset the flag.
 */
export function flashStatus(start, clear) {
  start()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => clear())
  })
}
