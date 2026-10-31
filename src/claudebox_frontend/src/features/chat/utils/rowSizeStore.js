/** Per-turn rendered sizes shared by the transcript's virtualizer and its minimap. */

/**
 * Create a store of turn sizes keyed by `turn_id`, readable with `useSyncExternalStore`.
 * Writes land immediately; subscribers hear of them at most once per animation frame.
 */
export function createRowSizeStore() {
  const sizes = new Map()
  const listeners = new Set()
  let version = 0
  let frame = null

  const publish = () => {
    frame = null
    version += 1
    for (const listener of listeners) {
      listener()
    }
  }

  const schedule = () => {
    if (frame === null) {
      frame = requestAnimationFrame(publish)
    }
  }

  return {
    get: turnId => sizes.get(turnId),
    set(turnId, px) {
      if (sizes.get(turnId) !== px) {
        sizes.set(turnId, px)
        schedule()
      }
    },
    delete(turnId) {
      if (sizes.delete(turnId)) {
        schedule()
      }
    },
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
