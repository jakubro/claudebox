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

const container = { querySelector: () => null }

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

  it('appends the active turn, which lives outside the windowed list', () => {
    const activeEl = { id: 'active' }
    const withActive = {
      querySelector: sel => (sel.includes('turn-container') ? activeEl : null),
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0 }),
    }
    activeEl.getBoundingClientRect = () => ({ top: 500 })
    const virtualizerRef = { current: { measurementsCache: lazyMeasurements(3) } }

    const targets = jumpTargets(withActive, virtualizerRef)

    expect(targets).toHaveLength(4)
    expect(targets[3].el).toBe(activeEl)
  })
})
