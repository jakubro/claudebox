/** Tests for jump target resolution against the virtualizer's measurement cache. */

import { describe, expect, it } from 'vitest'
import { jumpTargets } from './jumpTargets'

/**
 * Stands in for `@tanstack/virtual-core`'s measurements view: a Proxy over a SPARSE array with
 * only a `get` trap, so an entry exists only once something reads its index - a dense array would
 * pass regardless and prove nothing.
 */
function lazyMeasurements(count, materialized = []) {
  const target = new Array(count)
  for (const i of materialized) {
    target[i] = { index: i, start: i * 100, size: 100 }
  }

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        const i = Number(prop)
        if (i >= 0 && i < count) {
          obj[i] ||= { index: i, start: i * 100, size: 100 }
          return obj[i]
        }
      }
      if (prop === 'length') {
        return count
      }

      return Reflect.get(obj, prop, receiver)
    },
  })
}

const container = {}

describe('jumpTargets', () => {
  it('resolves a target for every turn, not just the mounted window', () => {
    const virtualizerRef = { current: { measurementsCache: lazyMeasurements(200, [98, 99, 100]) } }

    const targets = jumpTargets(container, virtualizerRef)

    expect(targets).toHaveLength(200)
    expect(targets[0]).toEqual({ start: 0, index: 0 })
    expect(targets[199]).toEqual({ start: 19900, index: 199 })
  })

  it('returns targets in scroll-axis order', () => {
    const virtualizerRef = { current: { measurementsCache: lazyMeasurements(5) } }

    const starts = jumpTargets(container, virtualizerRef).map(t => t.start)

    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('skips a turn the virtualizer has not priced yet', () => {
    const cache = [
      { index: 0, start: 0 },
      { index: 1, start: undefined },
      { index: 2, start: 200 },
    ]
    const virtualizerRef = { current: { measurementsCache: cache } }

    expect(jumpTargets(container, virtualizerRef).map(t => t.index)).toEqual([0, 2])
  })

  it('yields no targets when no virtualizer is registered', () => {
    expect(jumpTargets(container, undefined)).toEqual([])
    expect(jumpTargets(container, { current: null })).toEqual([])
  })

  it('appends a caller-supplied trailing element, which lives outside the windowed list', () => {
    const trailingContainer = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) }
    const trailingEl = { getBoundingClientRect: () => ({ top: 500 }) }
    const virtualizerRef = { current: { measurementsCache: lazyMeasurements(3) } }

    const targets = jumpTargets(trailingContainer, virtualizerRef, trailingEl)

    expect(targets).toHaveLength(4)
    expect(targets[3].el).toBe(trailingEl)
  })

  it('omits the trailing target when the caller supplies none', () => {
    const virtualizerRef = { current: { measurementsCache: lazyMeasurements(3) } }

    expect(jumpTargets(container, virtualizerRef).every(t => t.el === undefined)).toBe(true)
  })

  it('clamps the trailing target to the container max scrollTop, when it would otherwise be unreachable', () => {
    // Container already at its true max (scrollTop 190). The trailing entry's unclamped top-aligned
    // destination (250) exceeds the reachable max (200), so it would always compare as "ahead".
    const trailingContainer = {
      scrollTop: 190,
      scrollHeight: 300,
      clientHeight: 100,
      getBoundingClientRect: () => ({ top: 0 }),
    }
    const trailingEl = { getBoundingClientRect: () => ({ top: 60 }) }
    const virtualizerRef = { current: { measurementsCache: lazyMeasurements(0) } }

    const targets = jumpTargets(trailingContainer, virtualizerRef, trailingEl)

    expect(targets[0].start).toBe(200)
  })

  it('clamps a windowed entry whose cached start overshoots the real max (still-estimated siblings)', () => {
    // A cached start is a cumulative sum that can include not-yet-measured (estimated) sibling
    // heights near the end of the list, overshooting the container's real scrollable range.
    const shortContainer = { scrollHeight: 1000, clientHeight: 500 }
    const cache = [{ index: 0, start: 1200 }]
    const virtualizerRef = { current: { measurementsCache: cache } }

    const targets = jumpTargets(shortContainer, virtualizerRef)

    expect(targets[0].start).toBe(500)
  })

  it('does not clamp a trailing target that is genuinely reachable', () => {
    const trailingContainer = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0 }),
    }
    const trailingEl = { getBoundingClientRect: () => ({ top: 300 }) }
    const virtualizerRef = { current: { measurementsCache: lazyMeasurements(0) } }

    const targets = jumpTargets(trailingContainer, virtualizerRef, trailingEl)

    expect(targets[0].start).toBe(300)
  })
})
