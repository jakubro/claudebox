/** Tests for useMessageJump hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useMessageJump from './useMessageJump'

/**
 * Build a scroll container plus a virtualizer stub covering every turn.
 *
 * Targets come from virtualizer measurements, not mounted elements, so an unmounted turn is still addressable.
 * Turn rows are still created for turns the test mounts, since the highlight lands on a real element.
 */
function createHarness(options = {}) {
  const {
    scrollTop = 0,
    scrollHeight = 100000,
    clientHeight = 500,
    // One entry per turn, in scroll-axis order.
    measurements = [],
    mountedIndexes = [],
  } = options

  const container = document.createElement('div')
  container.scrollTop = scrollTop
  Object.defineProperty(container, 'scrollHeight', { get: () => scrollHeight })
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight })
  document.body.appendChild(container)

  // Mounted rows carry their virtual index - how a jump resolves its target, since a turn need not have an id.
  for (const index of mountedIndexes) {
    const row = document.createElement('div')
    row.className = 'historical-turn-row'
    row.setAttribute('data-index', String(index))
    const userEl = document.createElement('div')
    userEl.setAttribute('data-testid', 'message-user')
    row.appendChild(userEl)
    container.appendChild(row)
  }

  const virtualizer = {
    measurementsCache: measurements.map((m, index) => ({
      index,
      key: `turn-${index}`,
      start: m.start,
      size: m.size ?? 100,
    })),
    scrollToIndex: vi.fn(),
    options: { getItemKey: index => `turn-${index}` },
  }

  return {
    container,
    messagesRef: { current: container },
    virtualizerRef: { current: virtualizer },
    scrollToIndex: virtualizer.scrollToIndex,
  }
}

/** Render the hook with the harness, filling optional callbacks. */
function renderJump(h, { onProgrammatic, onIntent, onBottom } = {}) {
  return renderHook(() =>
    useMessageJump(h.messagesRef, onProgrammatic, onIntent, onBottom, h.virtualizerRef),
  )
}

describe('useMessageJump', () => {
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
    document.body.innerHTML = ''
  })

  // The mount wait chains several frames, each scheduling the next, so drain until the queue stops refilling.
  const flushRaf = () => {
    act(() => {
      for (let i = 0; i < 10 && rafCallbacks.length; i++) {
        for (const cb of rafCallbacks.splice(0)) {
          cb()
        }
      }
    })
  }

  describe('jumpPrev', () => {
    it('targets the last turn starting above the viewport', () => {
      const h = createHarness({
        scrollTop: 900,
        measurements: [{ start: 0 }, { start: 400 }, { start: 800 }, { start: 1200 }],
      })
      const { result } = renderJump(h)

      act(() => result.current.jumpPrev())

      expect(h.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
    })

    // Measurement-based targeting's point: this turn is far above the window, has no element, yet is reachable.
    it('reaches a turn that is not mounted', () => {
      const h = createHarness({
        scrollTop: 5000,
        measurements: [{ start: 0 }, { start: 4000 }, { start: 8000 }],
        mountedIndexes: [],
      })
      const { result } = renderJump(h)

      act(() => result.current.jumpPrev())

      expect(h.scrollToIndex).toHaveBeenCalledWith(1, { align: 'start' })
    })

    it('scrolls to the very top when nothing starts above the viewport', () => {
      const h = createHarness({ scrollTop: 0, measurements: [{ start: 0 }, { start: 400 }] })
      const { result } = renderJump(h)

      act(() => result.current.jumpPrev())

      expect(h.scrollToIndex).not.toHaveBeenCalled()
      expect(h.container.scrollTop).toBe(0)
    })

    it('highlights the jumped-to message once it mounts', () => {
      const h = createHarness({
        scrollTop: 900,
        measurements: [{ start: 0 }, { start: 800 }],
        mountedIndexes: [1],
      })
      const { result } = renderJump(h)

      act(() => result.current.jumpPrev())
      flushRaf()

      const target = h.container.querySelector(
        '.historical-turn-row[data-index="1"] [data-testid="message-user"]',
      )
      expect(target.classList.contains('jump-highlight')).toBe(true)
    })
  })

  describe('jumpNext', () => {
    it('targets the first turn starting below the viewport', () => {
      const h = createHarness({
        scrollTop: 400,
        measurements: [{ start: 0 }, { start: 400 }, { start: 800 }, { start: 1200 }],
      })
      const { result } = renderJump(h)

      act(() => result.current.jumpNext())

      expect(h.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
    })

    it('falls through to the bottom when nothing starts below the viewport', () => {
      const h = createHarness({
        scrollTop: 1500,
        scrollHeight: 2000,
        measurements: [{ start: 0 }, { start: 400 }],
      })
      const { result } = renderJump(h)

      act(() => result.current.jumpNext())

      expect(h.scrollToIndex).not.toHaveBeenCalled()
      expect(h.container.scrollTop).toBe(2000)
    })
  })

  describe('highlight lifecycle', () => {
    it('removes the highlight after the timeout', () => {
      vi.useFakeTimers()
      // useFakeTimers replaces rAF too; restore the capturing stub so the highlight callback stays observable.
      vi.stubGlobal('requestAnimationFrame', cb => {
        rafCallbacks.push(cb)
        return rafCallbacks.length
      })
      const h = createHarness({
        scrollTop: 900,
        measurements: [{ start: 0 }, { start: 800 }],
        mountedIndexes: [1],
      })
      const { result } = renderJump(h)

      act(() => result.current.jumpPrev())
      flushRaf()
      const target = h.container.querySelector(
        '.historical-turn-row[data-index="1"] [data-testid="message-user"]',
      )
      expect(target.classList.contains('jump-highlight')).toBe(true)

      act(() => vi.advanceTimersByTime(2000))

      expect(target.classList.contains('jump-highlight')).toBe(false)
      vi.useRealTimers()
    })
  })

  describe('autoscroll engagement transitions', () => {
    it('jumpPrev raises user intent and brackets the scroll write', () => {
      const onIntent = vi.fn()
      const onProgrammatic = vi.fn()
      const h = createHarness({ scrollTop: 900, measurements: [{ start: 0 }, { start: 800 }] })
      const { result } = renderJump(h, { onIntent, onProgrammatic })

      act(() => result.current.jumpPrev())

      expect(onIntent).toHaveBeenCalled()
      expect(onProgrammatic).toHaveBeenCalled()
    })

    it('jumpNext mid-list raises user intent', () => {
      const onIntent = vi.fn()
      const onProgrammatic = vi.fn()
      const h = createHarness({
        scrollTop: 0,
        measurements: [{ start: 0 }, { start: 400 }, { start: 800 }],
      })
      const { result } = renderJump(h, { onIntent, onProgrammatic })

      act(() => result.current.jumpNext())

      expect(onIntent).toHaveBeenCalled()
      expect(onProgrammatic).toHaveBeenCalled()
    })

    it('jumpNext fall-through re-engages autoscroll instead', () => {
      const onIntent = vi.fn()
      const onBottom = vi.fn()
      const onProgrammatic = vi.fn()
      const h = createHarness({ scrollTop: 1500, measurements: [{ start: 0 }, { start: 400 }] })
      const { result } = renderJump(h, { onIntent, onProgrammatic, onBottom })

      act(() => result.current.jumpNext())

      expect(onBottom).toHaveBeenCalled()
      expect(onIntent).not.toHaveBeenCalled()
      expect(onProgrammatic).toHaveBeenCalled()
    })

    it('jumpBottom re-engages autoscroll', () => {
      const onBottom = vi.fn()
      const h = createHarness({ scrollTop: 0, scrollHeight: 3000, measurements: [{ start: 0 }] })
      const { result } = renderJump(h, { onBottom })

      act(() => result.current.jumpBottom())

      expect(onBottom).toHaveBeenCalled()
      expect(h.container.scrollTop).toBe(3000)
    })

    it('jumpTop raises user intent', () => {
      const onIntent = vi.fn()
      const h = createHarness({ scrollTop: 900, measurements: [{ start: 0 }] })
      const { result } = renderJump(h, { onIntent })

      act(() => result.current.jumpTop())

      expect(onIntent).toHaveBeenCalled()
      expect(h.container.scrollTop).toBe(0)
    })
  })
})
