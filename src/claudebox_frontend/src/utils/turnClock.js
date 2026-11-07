/** One clock per start, ticking on its whole seconds so all its readers change together. */

const clocks = new Map()

/** Return the start plus the whole seconds elapsed since it, as of the start's last tick. */
export function turnClockNow(start) {
  return clocks.get(start)?.now ?? alignedNow(start)
}

/** Listen for the start's ticks; its clock runs while at least one listener is subscribed. */
export function subscribeTurnClock(start, listener) {
  let clock = clocks.get(start)
  if (!clock) {
    clock = { listeners: new Set(), now: alignedNow(start), timer: null }
    clocks.set(start, clock)
    schedule(start, clock)
  }
  clock.listeners.add(listener)

  return () => {
    clock.listeners.delete(listener)
    if (clock.listeners.size === 0) {
      clearTimeout(clock.timer)
      clocks.delete(start)
    }
  }
}

function schedule(start, clock) {
  const intoSecond = (((Date.now() - start) % 1000) + 1000) % 1000
  clock.timer = setTimeout(() => {
    clock.now = alignedNow(start)
    schedule(start, clock)
    for (const listener of clock.listeners) {
      listener()
    }
  }, 1000 - intoSecond)
}

function alignedNow(start) {
  return start + Math.floor((Date.now() - start) / 1000) * 1000
}
