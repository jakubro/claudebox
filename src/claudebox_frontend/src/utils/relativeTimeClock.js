/** One shared clock for relative times: a single interval while anything listens, re-read on tab return. */

import { RELATIVE_TIME_TICK_MS } from '../config/timing'

const listeners = new Set()
let now = Date.now()
let timer = null

/** The last tick's time while the clock runs, else the current time. */
export function clockNow() {
  return timer === null ? Date.now() : now
}

/** Listen for ticks; the clock runs while at least one listener is subscribed. */
export function subscribeClock(listener) {
  listeners.add(listener)
  if (listeners.size === 1) {
    now = Date.now()
    timer = setInterval(tick, RELATIVE_TIME_TICK_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

function tick() {
  now = Date.now()
  for (const listener of listeners) {
    listener()
  }
}

// Background tabs throttle intervals, so a tab coming back reads the clock at once.
function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    tick()
  }
}
