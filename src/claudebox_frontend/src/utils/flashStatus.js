/** Briefly flash a status flag for one paint cycle. */

/**
 * Calls `start()` immediately, then `clear()` after a double rAF - first frame lands post-layout, second after
 * dockview/router settle - so the flag stays visible for one full painted frame.
 * @param {() => void} start - Set the flag.
 * @param {() => void} clear - Unset the flag.
 */
export function flashStatus(start, clear) {
  start()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => clear())
  })
}
