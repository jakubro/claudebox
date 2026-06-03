/** Tests for scroll animation utilities. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeScrollDestination, easeOutCubic, scrollToEdge } from './scroll'

describe('easeOutCubic', () => {
  it('returns 0 at start (t=0)', () => {
    expect(easeOutCubic(0)).toBe(0)
  })

  it('returns 1 at end (t=1)', () => {
    expect(easeOutCubic(1)).toBe(1)
  })

  it('returns value between 0 and 1 for midpoint', () => {
    const result = easeOutCubic(0.5)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1)
    // Ease-out should be past halfway at t=0.5
    expect(result).toBeGreaterThan(0.5)
  })

  it('produces correct ease-out curve (decelerating)', () => {
    // Early progress should cover more distance than later progress
    const early = easeOutCubic(0.25) - easeOutCubic(0)
    const late = easeOutCubic(1) - easeOutCubic(0.75)
    expect(early).toBeGreaterThan(late)
  })
})

describe('computeScrollDestination', () => {
  it('aligns target top with container top (default edge)', () => {
    const container = createMockContainer({ scrollTop: 0 })
    // Target's top is 200 below container's top, scrollTop=0 → destination=200
    const target = createMockTarget({ top: 200, height: 80 })

    expect(computeScrollDestination(container, target)).toBe(200)
  })

  it('aligns target top with container top when container already scrolled', () => {
    const container = createMockContainer({ scrollTop: 150 })
    // Target's visual top is 200, container scrolled 150 → destination=350
    const target = createMockTarget({ top: 200, height: 80 })

    expect(computeScrollDestination(container, target, 'top')).toBe(350)
  })

  it('aligns target bottom with container bottom', () => {
    const container = createMockContainer({ scrollTop: 0, clientHeight: 500 })
    // target.bottom = -100 + 800 = 700; container.bottom = 0 + 500 = 500
    // destination = 700 - 500 + 0 = 200
    const target = createMockTarget({ top: -100, height: 800 })

    expect(computeScrollDestination(container, target, 'bottom')).toBe(200)
  })

  it('returns negative when target sits above container top (raw, not clamped)', () => {
    const container = createMockContainer({ scrollTop: 0 })
    // Target visually above the container top: returns negative destination
    const target = createMockTarget({ top: -50, height: 100 })

    expect(computeScrollDestination(container, target, 'top')).toBe(-50)
  })

  it('matches the scrollTop that scrollToEdge would write to', () => {
    const container = createMockContainer({ scrollTop: 0, clientHeight: 500 })
    const target = createMockTarget({ top: 333, height: 50 })

    const predicted = computeScrollDestination(container, target, 'top')

    // Drive scrollToEdge to completion and compare against the prediction.
    let rafCb
    vi.stubGlobal('requestAnimationFrame', cb => {
      rafCb = cb
      return 1
    })
    scrollToEdge(container, target, 'top', 150)
    rafCb(performance.now() + 150)
    vi.unstubAllGlobals()

    expect(container.scrollTop).toBe(predicted)
  })
})

describe('scrollToEdge', () => {
  let rafCallbacks = []

  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initiates requestAnimationFrame for top edge', () => {
    const container = createMockContainer()
    const target = createMockTarget({ top: 300 })

    scrollToEdge(container, target, 'top', 150)

    expect(rafCallbacks.length).toBe(1)
  })

  it('initiates requestAnimationFrame for bottom edge', () => {
    const container = createMockContainer()
    const target = createMockTarget({ top: 300 })

    scrollToEdge(container, target, 'bottom', 150)

    expect(rafCallbacks.length).toBe(1)
  })

  it('scrolls to align target top with container top', () => {
    const container = createMockContainer({ scrollTop: 0, clientHeight: 500 })
    // Target at top: 200 (relative to container at 0) -> destination = 200
    const target = createMockTarget({ top: 200, height: 800 })

    scrollToEdge(container, target, 'top', 150)

    // Run animation to completion
    const now = performance.now()
    rafCallbacks[0](now + 150)

    expect(container.scrollTop).toBe(200)
  })

  it('scrolls to align target bottom with container bottom', () => {
    const container = createMockContainer({ scrollTop: 0, clientHeight: 500 })
    // Target at top: -100, height: 800 -> bottom at 700
    // Container bottom = 0 + 500 = 500
    // Destination = 700 - 500 + 0 = 200
    const target = createMockTarget({ top: -100, height: 800 })

    scrollToEdge(container, target, 'bottom', 150)

    // Run animation to completion
    const now = performance.now()
    rafCallbacks[0](now + 150)

    expect(container.scrollTop).toBe(200)
  })
})

/**
 * Create a mock scrollable container.
 */
function createMockContainer(options = {}) {
  const { scrollTop = 0, clientHeight = 500 } = options
  return {
    scrollTop,
    clientHeight,
    getBoundingClientRect: () => ({ top: 0 }),
  }
}

/**
 * Create a mock target element.
 */
function createMockTarget(options = {}) {
  const { top = 0, height = 100 } = options
  return {
    getBoundingClientRect: () => ({ top, height }),
  }
}
