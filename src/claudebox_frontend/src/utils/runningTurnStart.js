/** The start of the turn running in the open transcript, readable from outside it. */

const listeners = new Set()
let held = null

/** Hold `start` as the running turn's; its release clears it unless a later hold took over. */
export function holdRunningTurnStart(start) {
  const hold = { start }
  held = hold
  notify()

  return () => {
    if (held === hold) {
      held = null
      notify()
    }
  }
}

/** Return the held start, or null while no turn runs in the transcript. */
export function runningTurnStart() {
  return held?.start ?? null
}

/** Listen for the held start changing. */
export function subscribeRunningTurnStart(listener) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function notify() {
  for (const listener of listeners) {
    listener()
  }
}
