/** Tests for the per-start turn clock. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeTurnClock, turnClockNow } from './turnClock'

describe('turnClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_300)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the start plus its whole seconds before anything subscribes', () => {
    expect(turnClockNow(7_000)).toBe(10_000)
  })

  it("ticks on the start's whole seconds, not on the subscriber's", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTurnClock(7_000, listener)

    vi.advanceTimersByTime(699)
    expect(listener).not.toHaveBeenCalled()
    expect(turnClockNow(7_000)).toBe(10_000)

    vi.advanceTimersByTime(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(turnClockNow(7_000)).toBe(11_000)

    vi.advanceTimersByTime(1_000)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(turnClockNow(7_000)).toBe(12_000)
    unsubscribe()
  })

  it('wakes every listener of one start in the same tick', () => {
    const order = []
    const first = subscribeTurnClock(7_000, () => order.push(['first', turnClockNow(7_000)]))
    vi.advanceTimersByTime(400)
    const second = subscribeTurnClock(7_000, () => order.push(['second', turnClockNow(7_000)]))

    vi.advanceTimersByTime(300)

    expect(order).toEqual([
      ['first', 11_000],
      ['second', 11_000],
    ])
    first()
    second()
  })

  it('stops once its last listener leaves', () => {
    const unsubscribe = subscribeTurnClock(7_000, vi.fn())
    expect(vi.getTimerCount()).toBe(1)

    unsubscribe()

    expect(vi.getTimerCount()).toBe(0)
  })
})
