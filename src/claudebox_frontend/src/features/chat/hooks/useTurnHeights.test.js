/** Tests for useTurnHeights hook — cache state machine + idle-warmup integration. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TURN_MIN_PREDICTED_HEIGHT_PX } from '../../../config/dimensions'
import useTurnHeights from './useTurnHeights'

// --- Mock observer plumbing ---

let originalMutationObserver
let originalResizeObserver
let originalIntersectionObserver
let mutationCallback
let resizeCallback
let intersectionCallback

beforeEach(() => {
  originalMutationObserver = globalThis.MutationObserver
  originalResizeObserver = globalThis.ResizeObserver
  originalIntersectionObserver = globalThis.IntersectionObserver
  mutationCallback = null
  resizeCallback = null
  intersectionCallback = null

  globalThis.MutationObserver = class {
    constructor(cb) {
      mutationCallback = cb
    }
    observe() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = class {
    constructor(cb) {
      resizeCallback = cb
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.IntersectionObserver = class {
    constructor(cb) {
      intersectionCallback = cb
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  globalThis.MutationObserver = originalMutationObserver
  globalThis.ResizeObserver = originalResizeObserver
  globalThis.IntersectionObserver = originalIntersectionObserver
})

// --- Mock-element factory ---

/**
 * Build a mock chat container + matching turns array for useTurnHeights.
 *
 * Each spec drives one turn-container element AND one entry in the turns array
 * (so the predictor can look up turn data by turn_id). Pass `turnId: false` to
 * simulate a pending turn (no data-turn-id, reported live).
 */
function createMockContainer(specs, { clientWidth = 800 } = {}) {
  const turnElements = specs.map((spec, i) => {
    const turnId = spec.turnId === false ? null : (spec.turnId ?? `turn-${i}`)
    const classes = new Set()
    return {
      _spec: spec,
      offsetHeight: spec.totalHeight ?? 100,
      classList: {
        add: vi.fn(c => classes.add(c)),
        remove: vi.fn(c => classes.delete(c)),
        contains: c => classes.has(c),
      },
      getAttribute: vi.fn(attr => (attr === 'data-turn-id' ? turnId : null)),
      querySelector: vi.fn(selector => {
        if (selector === '[data-testid="message-user"]' && (spec.userHeight ?? 0) > 0) {
          return { offsetHeight: spec.userHeight }
        }
        return null
      }),
    }
  })

  const container = {
    clientWidth,
    querySelectorAll: vi.fn(selector => {
      if (selector === '[data-testid="turn-container"]') {
        return turnElements
      }
      return []
    }),
  }

  const turns = specs.map((spec, i) => ({
    turn_id: spec.turnId === false ? null : (spec.turnId ?? `turn-${i}`),
    userMessage: spec.userMessage ?? '',
    events: spec.events ?? [],
    attachments: spec.attachments ?? null,
  }))

  return { messagesRef: { current: container }, turns, turnElements, container }
}

/** Fire IntersectionObserver callback to mark each element as intersecting (or not). */
function markIntersecting(elements, isIntersecting) {
  act(() => {
    intersectionCallback?.(elements.map(target => ({ target, isIntersecting })))
  })
}

describe('useTurnHeights — initial mount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty objects when messagesRef is null', () => {
    const { result } = renderHook(() => useTurnHeights({ current: null }, []))
    expect(result.current.turnHeights).toEqual({})
    expect(result.current.userMessageHeights).toEqual({})
  })

  it('returns empty objects when container has no turns', () => {
    const { messagesRef, turns } = createMockContainer([])
    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    expect(result.current.turnHeights).toEqual({})
    expect(result.current.userMessageHeights).toEqual({})
  })

  it('caches real measurement for on-screen turns', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 200, userHeight: 40 },
      { totalHeight: 500, userHeight: 400 },
      { totalHeight: 300, userHeight: 0 },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    // Mark on-screen + fire resize so the next rAF replaces predicted with real.
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })

    expect(result.current.turnHeights).toEqual({ 0: 200, 1: 500, 2: 300 })
    expect(result.current.userMessageHeights).toEqual({ 0: 40, 1: 400, 2: 0 })
  })

  it('caches prediction for off-screen turns instead of intrinsic-size measurement', () => {
    // Off-screen turn with no events → prediction at the MIN floor (100).
    // offsetHeight = 400 simulates the content-visibility:auto intrinsic placeholder
    // that the cache must NOT trust.
    const { messagesRef, turns } = createMockContainer([
      { totalHeight: 400, userHeight: 0, events: [] },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))

    // No IntersectionObserver fire → off-screen → predicted (MIN floor).
    expect(result.current.turnHeights[0]).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)
    expect(result.current.turnHeights[0]).not.toBe(400) // not the misleading placeholder
    expect(result.current.userMessageHeights[0]).toBe(0)
  })

  it('sets userMessageHeight to 0 when on-screen turn has no user message element', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 300, userHeight: 0 },
    ])
    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })

    expect(result.current.turnHeights).toEqual({ 0: 300 })
    expect(result.current.userMessageHeights).toEqual({ 0: 0 })
  })

  it('attaches observers when container appears after initial null', () => {
    const messagesRef = { current: null }
    const { result, rerender } = renderHook(({ ref, t }) => useTurnHeights(ref, t), {
      initialProps: { ref: messagesRef, t: [] },
    })

    expect(result.current.turnHeights).toEqual({})

    const replacement = createMockContainer([
      { totalHeight: 250, userHeight: 50, turnId: 'turn-a' },
    ])
    messagesRef.current = replacement.messagesRef.current
    rerender({ ref: messagesRef, t: replacement.turns })
    markIntersecting(replacement.turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })

    expect(result.current.turnHeights).toEqual({ 0: 250 })
    expect(result.current.userMessageHeights).toEqual({ 0: 50 })
    expect(resizeCallback).not.toBeNull()
  })
})

describe('useTurnHeights — sticky cache under content-visibility:auto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes height while on-screen (collapse/expand)', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 500, userHeight: 40, turnId: 'turn-collapse' },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.turnHeights).toEqual({ 0: 500 })

    // Simulate collapse — height shrinks; on-screen still, so cache refreshes.
    turnElements[0].offsetHeight = 60
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.turnHeights).toEqual({ 0: 60 })
  })

  it('does not overwrite cached real height with intrinsic placeholder when off-screen', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 800, userHeight: 0, turnId: 'turn-stable' },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    // First mark on-screen → cache stores 800 real
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.turnHeights).toEqual({ 0: 800 })

    // Turn goes off-screen; ResizeObserver fires with the 400 intrinsic placeholder
    markIntersecting(turnElements, false)
    turnElements[0].offsetHeight = 400
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    // Cached 800 wins — off-screen fire ignored.
    expect(result.current.turnHeights).toEqual({ 0: 800 })
  })

  it('refreshes while on-screen (streaming growth)', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 200, userHeight: 0, turnId: 'turn-streaming' },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.turnHeights).toEqual({ 0: 200 })

    turnElements[0].offsetHeight = 600
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.turnHeights).toEqual({ 0: 600 })
  })

  it('upgrades a predicted entry to real measurement on first on-screen visit', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 800, userHeight: 0, turnId: 'turn-upgrade' },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    // First observation off-screen → prediction (min floor since no events).
    expect(result.current.turnHeights[0]).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)

    // Turn scrolls into view; next ResizeObserver fire upgrades cache to 800.
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.turnHeights[0]).toBe(800)
  })

  it('getLogicalScrollHeight sums cached heights (on-screen real, off-screen predicted)', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 800, turnId: 'a' },
      { totalHeight: 1200, turnId: 'b' },
      { totalHeight: 400, turnId: 'c' },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })

    expect(result.current.getLogicalScrollHeight()).toBe(2400)

    // Off-screen ResizeObserver reporting intrinsic 400 for turnB does NOT change logical.
    markIntersecting([turnElements[1]], false)
    turnElements[1].offsetHeight = 400
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.getLogicalScrollHeight()).toBe(2400)
  })

  it('coalesces multiple observer callbacks into single RAF', () => {
    const { messagesRef, turns, container } = createMockContainer([
      { totalHeight: 300, turnId: 'turn-coalesce' },
    ])
    renderHook(() => useTurnHeights(messagesRef, turns))
    // Drain the idle warmup loop first — its onCacheUpdate also calls
    // querySelectorAll and would inflate the steady-state count.
    act(() => vi.runAllTimers())
    container.querySelectorAll.mockClear()

    act(() => {
      resizeCallback?.()
      mutationCallback?.()
      resizeCallback?.()
    })
    act(() => vi.runAllTimers())

    // Coalesced into ≤2 scans (one for updateHeights, optionally one for observeTurns from mutation).
    expect(container.querySelectorAll.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

describe('useTurnHeights — idle warmup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Force setTimeout fallback (jsdom lacks requestIdleCallback anyway).
    if ('requestIdleCallback' in globalThis) {
      delete globalThis.requestIdleCallback
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('replaces predicted entries with real measurements via force-measure pass', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 800, userHeight: 30, turnId: 'turn-warm' },
    ])

    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    // Off-screen first observation → predicted (MIN floor).
    expect(result.current.turnHeights[0]).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)

    // Idle scheduler queued via setTimeout(0); advance to fire warmup.
    act(() => vi.runAllTimers())

    expect(turnElements[0].classList.add).toHaveBeenCalledWith('force-measure')
    expect(turnElements[0].classList.remove).toHaveBeenCalledWith('force-measure')
    expect(result.current.turnHeights[0]).toBe(800)
    expect(result.current.userMessageHeights[0]).toBe(30)
  })

  it('skips turns currently on-screen (regular observer covers them)', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 500, turnId: 'turn-on-screen' },
    ])
    renderHook(() => useTurnHeights(messagesRef, turns))
    markIntersecting(turnElements, true)
    // Cache stored real measurement immediately because on-screen first observation.

    act(() => vi.runAllTimers())
    // Warmup must not touch on-screen turns.
    expect(turnElements[0].classList.add).not.toHaveBeenCalled()
  })

  it('skips turns already real-measured (predicted:false)', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 600, turnId: 'turn-already-real' },
    ])
    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    // First mark on-screen → cache stores real
    markIntersecting(turnElements, true)
    act(() => {
      resizeCallback?.()
      vi.runAllTimers()
    })
    expect(result.current.turnHeights[0]).toBe(600)
    turnElements[0].classList.add.mockClear()

    // Turn goes off-screen; warmup runs again on next turns.length tick.
    markIntersecting(turnElements, false)
    act(() => vi.runAllTimers())

    expect(turnElements[0].classList.add).not.toHaveBeenCalled()
  })

  it('defers while streaming and resumes when streaming ends', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 700, turnId: 'turn-streaming' },
    ])
    const { rerender, result } = renderHook(({ s }) => useTurnHeights(messagesRef, turns, s), {
      initialProps: { s: true },
    })

    // runOnlyPendingTimers fires the currently-queued warmup tick once.
    // Streaming guard → reschedules. New timer is NOT executed this pass,
    // so we avoid the infinite-reschedule loop that runAllTimers would trip.
    act(() => vi.runOnlyPendingTimers())
    expect(turnElements[0].classList.add).not.toHaveBeenCalled()
    expect(result.current.turnHeights[0]).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)

    // Streaming ends → run the previously-rescheduled timer, warmup proceeds.
    rerender({ s: false })
    act(() => vi.runOnlyPendingTimers())
    expect(turnElements[0].classList.add).toHaveBeenCalledWith('force-measure')
    expect(result.current.turnHeights[0]).toBe(700)
  })

  it('stops scheduling once all turns are measured', () => {
    const { messagesRef, turns, turnElements } = createMockContainer([
      { totalHeight: 500, turnId: 'turn-once' },
    ])
    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))
    act(() => vi.runAllTimers())
    expect(result.current.turnHeights[0]).toBe(500)
    turnElements[0].classList.add.mockClear()

    // Another idle pass should be a no-op — cache already has real measurement.
    act(() => vi.runAllTimers())
    expect(turnElements[0].classList.add).not.toHaveBeenCalled()
  })
})
