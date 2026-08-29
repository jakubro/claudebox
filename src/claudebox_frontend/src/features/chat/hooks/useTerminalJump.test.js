/** Tests for useTerminalJump hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useTerminalJump from './useTerminalJump'

/**
 * Build a scroll container plus a virtualizer stub covering every entry, for `.terminal-entry`
 * rows and a caller-supplied trailing element rather than a `:scope >` query.
 */
function createHarness(options = {}) {
  const {
    scrollTop = 0,
    scrollHeight = 100000,
    clientHeight = 500,
    measurements = [],
    mountedIndexes = [],
    trailingEl = null,
  } = options

  const container = document.createElement('div')
  container.scrollTop = scrollTop
  container.getBoundingClientRect = () => ({ top: 0 })
  Object.defineProperty(container, 'scrollHeight', { get: () => scrollHeight })
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight })
  document.body.appendChild(container)

  for (const index of mountedIndexes) {
    const row = document.createElement('div')
    row.className = 'terminal-entry'
    row.setAttribute('data-index', String(index))
    container.appendChild(row)
  }

  const virtualizer = {
    measurementsCache: measurements.map((m, index) => ({
      index,
      start: m.start,
      size: m.size ?? 100,
    })),
    scrollToIndex: vi.fn(),
  }

  return {
    container,
    containerRef: { current: container },
    virtualizerRef: { current: virtualizer },
    trailingEntryRef: { current: trailingEl },
    scrollToIndex: virtualizer.scrollToIndex,
  }
}

/** Render the hook with the harness, filling optional engagement-transition callbacks. */
function renderJump(h, { onIntent, onBottom, onProgrammatic } = {}) {
  return renderHook(() =>
    useTerminalJump({
      containerRef: h.containerRef,
      virtualizerRef: h.virtualizerRef,
      trailingEntryRef: h.trailingEntryRef,
      markProgrammaticScroll: onProgrammatic,
      markUserIntent: onIntent,
      markReturnedToBottom: onBottom,
    }),
  )
}

describe('useTerminalJump', () => {
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

  const flushRaf = () => {
    act(() => {
      for (let i = 0; i < 10 && rafCallbacks.length; i++) {
        for (const cb of rafCallbacks.splice(0)) {
          cb()
        }
      }
    })
  }

  it('exposes only stepPrev/stepNext - no jumpTop/jumpBottom, unlike the transcript', () => {
    const h = createHarness()
    const { result } = renderJump(h)

    expect(Object.keys(result.current).sort()).toEqual(['stepNext', 'stepPrev'])
  })

  describe('stepPrev', () => {
    it('targets the last entry starting above the viewport', () => {
      const h = createHarness({
        scrollTop: 900,
        measurements: [{ start: 0 }, { start: 400 }, { start: 800 }],
      })
      const { result } = renderJump(h)

      act(() => result.current.stepPrev())

      expect(h.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
    })

    it('reaches an entry that is not mounted', () => {
      const h = createHarness({
        scrollTop: 5000,
        measurements: [{ start: 0 }, { start: 4000 }, { start: 8000 }],
      })
      const { result } = renderJump(h)

      act(() => result.current.stepPrev())

      expect(h.scrollToIndex).toHaveBeenCalledWith(1, { align: 'start' })
    })

    it('settles at the very top when nothing starts above the viewport', () => {
      const h = createHarness({ scrollTop: 0, measurements: [{ start: 0 }, { start: 400 }] })
      const { result } = renderJump(h)

      act(() => result.current.stepPrev())

      expect(h.scrollToIndex).not.toHaveBeenCalled()
      expect(h.container.scrollTop).toBe(0)
    })
  })

  describe('stepNext', () => {
    it('targets the first entry starting below the viewport', () => {
      const h = createHarness({
        scrollTop: 0,
        measurements: [{ start: 0 }, { start: 400 }, { start: 800 }],
      })
      const { result } = renderJump(h)

      act(() => result.current.stepNext())

      expect(h.scrollToIndex).toHaveBeenCalledWith(1, { align: 'start' })
    })

    it('lands directly on the trailing entry when it is the next target', () => {
      const trailingEl = document.createElement('div')
      trailingEl.getBoundingClientRect = () => ({ top: 500 })
      const h = createHarness({ scrollTop: 0, measurements: [{ start: 0 }], trailingEl })
      const { result } = renderJump(h)

      act(() => result.current.stepNext())

      expect(h.scrollToIndex).not.toHaveBeenCalled()
      expect(h.container.scrollTop).toBe(500)
    })

    it('falls through to the absolute end when even the trailing entry is above the viewport', () => {
      const h = createHarness({ scrollTop: 1500, scrollHeight: 2000, measurements: [{ start: 0 }] })
      const { result } = renderJump(h)

      act(() => result.current.stepNext())

      expect(h.scrollToIndex).not.toHaveBeenCalled()
      expect(h.container.scrollTop).toBe(2000)
    })
  })

  describe('landing highlight', () => {
    it('flashes the entry itself - the terminal has no nested highlight sub-element', () => {
      const h = createHarness({
        scrollTop: 900,
        measurements: [{ start: 0 }, { start: 800 }],
        mountedIndexes: [1],
      })
      const { result } = renderJump(h)

      act(() => result.current.stepPrev())
      flushRaf()

      const target = h.container.querySelector('.terminal-entry[data-index="1"]')
      expect(target.classList.contains('jump-highlight')).toBe(true)
    })
  })

  describe('autoscroll engagement transitions', () => {
    it('stepPrev raises user intent', () => {
      const onIntent = vi.fn()
      const h = createHarness({ scrollTop: 900, measurements: [{ start: 0 }, { start: 800 }] })
      const { result } = renderJump(h, { onIntent })

      act(() => result.current.stepPrev())

      expect(onIntent).toHaveBeenCalled()
    })

    it('stepNext fall-through re-engages autoscroll instead of raising intent', () => {
      const onIntent = vi.fn()
      const onBottom = vi.fn()
      const h = createHarness({ scrollTop: 1500, measurements: [{ start: 0 }, { start: 400 }] })
      const { result } = renderJump(h, { onIntent, onBottom })

      act(() => result.current.stepNext())

      expect(onBottom).toHaveBeenCalled()
      expect(onIntent).not.toHaveBeenCalled()
    })

    it('brackets every direct scrollTop write with markProgrammaticScroll, landing on the trailing entry included - without it, a scroll landing near the bottom would silently re-engage autoscroll in the same tick markUserIntent just disengaged it', () => {
      const onProgrammatic = vi.fn()
      const trailingEl = document.createElement('div')
      trailingEl.getBoundingClientRect = () => ({ top: 500 })
      const h = createHarness({ scrollTop: 0, measurements: [{ start: 0 }], trailingEl })
      const { result } = renderJump(h, { onProgrammatic })

      act(() => result.current.stepNext())

      expect(onProgrammatic).toHaveBeenCalled()
    })
  })
})
