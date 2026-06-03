/** Idle-time force-measure pass that upgrades predicted turn heights to real measurements. */

import { WARMUP_CHUNK_SIZE, WARMUP_MIN_IDLE_MS } from '../../../config/dimensions'

const idleSchedule =
  typeof globalThis.requestIdleCallback === 'function'
    ? cb => globalThis.requestIdleCallback(cb, { timeout: 1000 })
    : cb => setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: false }), 0)

/**
 * Walk predicted off-screen turns in chunks, force-measure real heights, replace predictions.
 *
 * Re-schedules itself via requestIdleCallback until no predicted off-screen turns remain.
 * Defers while `isStreamingRef.current` is true. Honors `shouldStopRef` for effect cleanup.
 */
export function scheduleIdleWarmup({
  containerEl,
  cacheRef,
  onScreenRef,
  isStreamingRef,
  shouldStopRef,
  onCacheUpdate,
  onComplete,
}) {
  const run = deadline => {
    if (shouldStopRef.current) {
      onComplete()
      return
    }
    if (isStreamingRef.current) {
      idleSchedule(run)
      return
    }
    if (deadline.timeRemaining() < WARMUP_MIN_IDLE_MS) {
      idleSchedule(run)
      return
    }

    const allElements = containerEl.querySelectorAll('[data-testid="turn-container"]')
    const pending = []
    for (const el of allElements) {
      const turnId = el.getAttribute('data-turn-id')
      if (!turnId) {
        continue
      }
      if (onScreenRef.current.has(turnId)) {
        continue
      }
      const cached = cacheRef.current.get(turnId)
      if (cached && !cached.predicted) {
        continue
      }
      pending.push(el)
    }

    if (pending.length === 0) {
      onComplete()
      return
    }

    const chunk = pending.slice(0, WARMUP_CHUNK_SIZE)
    forceMeasureChunk(chunk, cacheRef)
    onCacheUpdate()

    if (pending.length > chunk.length) {
      idleSchedule(run)
    } else {
      onComplete()
    }
  }

  idleSchedule(run)
}

/** Apply force-measure class, capture real heights via synchronous offsetHeight, remove class. */
function forceMeasureChunk(elements, cacheRef) {
  for (const el of elements) {
    el.classList.add('force-measure')
  }
  // offsetHeight forces synchronous layout — content-visibility:visible (via .force-measure)
  // ensures the read returns real layout instead of the intrinsic-size estimate.
  const readings = []
  for (const el of elements) {
    const turnId = el.getAttribute('data-turn-id')
    const height = el.offsetHeight
    const userEl = el.querySelector('[data-testid="message-user"]')
    const userHeight = userEl ? userEl.offsetHeight : 0
    readings.push({ turnId, height, userHeight })
  }
  for (const el of elements) {
    el.classList.remove('force-measure')
  }
  for (const { turnId, height, userHeight } of readings) {
    if (turnId && height > 0) {
      cacheRef.current.set(turnId, { height, userHeight, predicted: false })
    }
  }
}
