/** Tests for MinimapController. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MinimapController from './MinimapController'

describe('MinimapController', () => {
  let onViewportChange, onVisibilityChange, controller
  let containerEl, mapEl
  let resizeObserverInstances

  beforeEach(() => {
    vi.useFakeTimers()

    // Stub ResizeObserver as a proper class (global mock is arrow fn, can't be used with `new`)
    resizeObserverInstances = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb) {
          this._cb = cb
          this.observe = vi.fn()
          this.unobserve = vi.fn()
          this.disconnect = vi.fn()
          resizeObserverInstances.push(this)
        }
        /** Simulate a resize event. */
        trigger() {
          this._cb()
        }
      },
    )

    onViewportChange = vi.fn()
    onVisibilityChange = vi.fn()
    controller = new MinimapController({ onViewportChange, onVisibilityChange })

    containerEl = {
      scrollHeight: 2000,
      clientHeight: 500,
      scrollTop: 0,
      scrollTo: vi.fn(),
      getBoundingClientRect: () => ({ top: 0, right: 500, bottom: 500, left: 0 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    mapEl = {
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 0, height: 400, left: 0, right: 20 }),
    }
  })

  afterEach(() => {
    controller.detach()
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('starts not visible', () => {
      expect(controller.isVisible).toBe(false)
    })

    it('has default viewport', () => {
      expect(controller.viewport).toEqual({ top: 0, height: 100 })
    })
  })

  describe('attach / detach', () => {
    it('adds scroll and pointermove listeners on attach', () => {
      controller.attach(containerEl, mapEl)

      expect(containerEl.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
      expect(containerEl.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    })

    it('observes container with ResizeObserver on attach', () => {
      controller.attach(containerEl, mapEl)

      expect(resizeObserverInstances).toHaveLength(1)
      expect(resizeObserverInstances[0].observe).toHaveBeenCalledWith(containerEl)
    })

    it('removes listeners and disconnects ResizeObserver on detach', () => {
      controller.attach(containerEl, mapEl)
      const observer = resizeObserverInstances[0]

      controller.detach()

      expect(containerEl.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
      expect(containerEl.removeEventListener).toHaveBeenCalledWith(
        'pointermove',
        expect.any(Function),
      )
      expect(observer.disconnect).toHaveBeenCalled()
    })

    it('computes viewport immediately on attach', () => {
      controller.attach(containerEl, mapEl)

      expect(onViewportChange).toHaveBeenCalledWith(
        expect.objectContaining({ top: expect.any(Number), height: expect.any(Number) }),
      )
    })

    it('handles null container gracefully', () => {
      expect(() => controller.attach(null, mapEl)).not.toThrow()
    })

    it('detaches previous listeners before reattaching', () => {
      controller.attach(containerEl, mapEl)
      const newContainer = {
        ...containerEl,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }
      controller.attach(newContainer, mapEl)

      expect(containerEl.removeEventListener).toHaveBeenCalled()
      expect(newContainer.addEventListener).toHaveBeenCalled()
    })
  })

  describe('viewport calculation', () => {
    it('sets full height when content fits in viewport', () => {
      containerEl.scrollHeight = 500
      containerEl.clientHeight = 500
      controller.attach(containerEl, mapEl)

      expect(onViewportChange).toHaveBeenCalledWith({ top: 0, height: 400 })
    })

    it('computes proportional viewport when scrolled', () => {
      containerEl.scrollTop = 500
      controller.attach(containerEl, mapEl)

      // top = (500 / 2000) * 400 = 100
      // height = (500 / 2000) * 400 = 100
      expect(onViewportChange).toHaveBeenCalledWith({ top: 100, height: 100 })
    })

    it('enforces minimum thumb height of 16', () => {
      containerEl.scrollHeight = 50000
      containerEl.clientHeight = 100
      controller.attach(containerEl, mapEl)

      // Raw height = (100 / 50000) * 400 = 0.8 -> clamped to 16
      const viewport = onViewportChange.mock.calls[0][0]
      expect(viewport.height).toBe(16)
    })

    it('updateViewport() recomputes from current scroll', () => {
      controller.attach(containerEl, mapEl)
      onViewportChange.mockClear()

      containerEl.scrollTop = 1000
      controller.updateViewport()

      // top = (1000 / 2000) * 400 = 200
      expect(onViewportChange).toHaveBeenCalledWith({ top: 200, height: 100 })
    })
  })

  describe('visibility: show / auto-hide', () => {
    it('show() sets visible and emits', () => {
      controller.show()
      expect(controller.isVisible).toBe(true)
      expect(onVisibilityChange).toHaveBeenCalledWith(true)
    })

    it('auto-hides after 750ms', () => {
      controller.show()
      vi.advanceTimersByTime(749)
      expect(controller.isVisible).toBe(true)

      vi.advanceTimersByTime(1)
      expect(controller.isVisible).toBe(false)
      expect(onVisibilityChange).toHaveBeenCalledWith(false)
    })

    it('resets timer on repeated show()', () => {
      controller.show()
      vi.advanceTimersByTime(500)
      controller.show()
      vi.advanceTimersByTime(500)

      // Only 500ms since last show — still visible
      expect(controller.isVisible).toBe(true)

      vi.advanceTimersByTime(250)
      expect(controller.isVisible).toBe(false)
    })

    it('does not emit when visibility value unchanged', () => {
      controller.show()
      onVisibilityChange.mockClear()
      controller.show()

      // Already visible, should not re-emit
      expect(onVisibilityChange).not.toHaveBeenCalled()
    })
  })

  describe('persistent mode', () => {
    it('setPersistent(true) makes visible and clears timer', () => {
      controller.setPersistent(true)
      expect(controller.isVisible).toBe(true)

      vi.advanceTimersByTime(2000)
      expect(controller.isVisible).toBe(true)
    })

    it('show() is a no-op when persistent', () => {
      controller.setPersistent(true)
      onVisibilityChange.mockClear()

      controller.show()
      vi.advanceTimersByTime(2000)

      // Still visible, no extra emissions
      expect(controller.isVisible).toBe(true)
    })

    it('show() clears pending hide timeout when persistent', () => {
      controller.show()
      // hide scheduled at 750ms
      vi.advanceTimersByTime(500)

      controller.setPersistent(true)
      // Trigger show() while persistent (e.g. scroll event)
      controller.show()

      vi.advanceTimersByTime(2000)
      expect(controller.isVisible).toBe(true)
    })

    it('setPersistent(false) hides immediately', () => {
      controller.setPersistent(true)
      expect(controller.isVisible).toBe(true)

      controller.setPersistent(false)
      expect(controller.isVisible).toBe(false)
    })
  })

  describe('handleClick', () => {
    it('scrolls container to proportional position', () => {
      controller.attach(containerEl, mapEl)

      controller.handleClick(200, 400)
      expect(containerEl.scrollTo).toHaveBeenCalledWith({
        top: 1000, // (200/400) * 2000
        behavior: 'smooth',
      })
    })

    it('does nothing when no container attached', () => {
      expect(() => controller.handleClick(100, 400)).not.toThrow()
    })

    it('does nothing when mapHeight is zero', () => {
      controller.attach(containerEl, mapEl)
      controller.handleClick(100, 0)
      expect(containerEl.scrollTo).not.toHaveBeenCalled()
    })
  })

  describe('startDrag', () => {
    it('sets scrollTop immediately from initial event', () => {
      controller.attach(containerEl, mapEl)

      controller.startDrag({ clientY: 200 })

      // ratio = (200 - 0) / 400 = 0.5
      // scrollTop = 0.5 * (2000 - 500) = 750
      expect(containerEl.scrollTop).toBe(750)
    })

    it('returns cleanup function', () => {
      controller.attach(containerEl, mapEl)
      const cleanup = controller.startDrag({ clientY: 100 })
      expect(typeof cleanup).toBe('function')
    })

    it('does not schedule hide after drag when persistent', () => {
      controller.attach(containerEl, mapEl)
      controller.setPersistent(true)
      const cleanup = controller.startDrag({ clientY: 200 })

      cleanup()
      vi.advanceTimersByTime(2000)

      expect(controller.isVisible).toBe(true)
    })

    it('returns no-op when no container', () => {
      const cleanup = controller.startDrag({ clientY: 100 })
      expect(typeof cleanup).toBe('function')
    })
  })

  describe('handleMouseEnter / handleMouseLeave', () => {
    it('handleMouseEnter clears hide timer and shows', () => {
      controller.show()
      vi.advanceTimersByTime(500)

      controller.handleMouseEnter()
      vi.advanceTimersByTime(2000)

      // Should still be visible (timer was cleared)
      expect(controller.isVisible).toBe(true)
    })

    it('handleMouseLeave schedules hide after 500ms', () => {
      controller.handleMouseEnter()
      expect(controller.isVisible).toBe(true)

      controller.handleMouseLeave()
      vi.advanceTimersByTime(499)
      expect(controller.isVisible).toBe(true)

      vi.advanceTimersByTime(1)
      expect(controller.isVisible).toBe(false)
    })

    it('handleMouseLeave is a no-op when persistent', () => {
      controller.setPersistent(true)
      controller.handleMouseLeave()
      vi.advanceTimersByTime(2000)

      expect(controller.isVisible).toBe(true)
    })
  })

  describe('streaming mode', () => {
    it('setStreaming(true) shows minimap and clears hide timer', () => {
      controller.show()
      vi.advanceTimersByTime(500)

      controller.setStreaming(true)
      vi.advanceTimersByTime(2000)

      expect(controller.isVisible).toBe(true)
    })

    it('setStreaming(false) schedules hide when not persistent', () => {
      controller.setStreaming(true)
      expect(controller.isVisible).toBe(true)

      controller.setStreaming(false)
      vi.advanceTimersByTime(749)
      expect(controller.isVisible).toBe(true)

      vi.advanceTimersByTime(1)
      expect(controller.isVisible).toBe(false)
    })

    it('setStreaming(false) stays visible when persistent', () => {
      controller.setPersistent(true)
      controller.setStreaming(true)
      controller.setStreaming(false)

      vi.advanceTimersByTime(2000)
      expect(controller.isVisible).toBe(true)
    })

    it('shows minimap on scroll during streaming even with autoscroll enabled', () => {
      const autoScrollRef = { current: true }
      controller.attach(containerEl, mapEl, autoScrollRef)
      controller.setStreaming(true)

      const scrollHandler = containerEl.addEventListener.mock.calls.find(c => c[0] === 'scroll')[1]
      scrollHandler()

      expect(controller.isVisible).toBe(true)
    })
  })

  describe('scroll listener integration', () => {
    it('shows minimap on scroll when autoscroll disabled', () => {
      const autoScrollRef = { current: false }
      controller.attach(containerEl, mapEl, autoScrollRef)

      const scrollHandler = containerEl.addEventListener.mock.calls.find(c => c[0] === 'scroll')[1]

      scrollHandler()

      expect(controller.isVisible).toBe(true)
    })

    it('does not show on scroll when autoscroll enabled', () => {
      const autoScrollRef = { current: true }
      controller.attach(containerEl, mapEl, autoScrollRef)

      const scrollHandler = containerEl.addEventListener.mock.calls.find(c => c[0] === 'scroll')[1]

      scrollHandler()

      expect(controller.isVisible).toBe(false)
    })
  })

  describe('pointer proximity listener', () => {
    it('shows minimap when pointer is near right edge', () => {
      controller.attach(containerEl, mapEl)

      const pointerMoveHandler = containerEl.addEventListener.mock.calls.find(
        c => c[0] === 'pointermove',
      )[1]

      pointerMoveHandler({ clientX: 470 }) // 30px from right edge at 500
      expect(controller.isVisible).toBe(true)
    })

    it('does not show when pointer is far from right edge', () => {
      controller.attach(containerEl, mapEl)

      const pointerMoveHandler = containerEl.addEventListener.mock.calls.find(
        c => c[0] === 'pointermove',
      )[1]

      pointerMoveHandler({ clientX: 200 }) // 300px from right edge
      expect(controller.isVisible).toBe(false)
    })
  })

  describe('resize observer integration', () => {
    it('recomputes viewport when container resizes', () => {
      containerEl.scrollTop = 500
      controller.attach(containerEl, mapEl)
      onViewportChange.mockClear()

      // Simulate container resize — new dimensions
      containerEl.scrollHeight = 4000
      containerEl.clientHeight = 800
      mapEl.clientHeight = 800
      resizeObserverInstances[0].trigger()

      // top = (500 / 4000) * 800 = 100
      // height = (800 / 4000) * 800 = 160
      expect(onViewportChange).toHaveBeenCalledWith({ top: 100, height: 160 })
    })
  })

  describe('detach cleanup', () => {
    it('clears pending hide timeout on detach', () => {
      controller.show()
      controller.detach()

      vi.advanceTimersByTime(2000)
      // Should still be visible because the hide timer was cleared
      expect(controller.isVisible).toBe(true)
    })
  })

  describe('viewport sizing (logical scrollHeight for jitter resistance)', () => {
    // SIZE uses the logical denominator so the thumb HEIGHT does not jitter
    // as off-screen turns toggle between intrinsic 400px placeholders and
    // real heights (content-visibility:auto behavior).

    it('thumb height uses getLogicalScrollHeight when supplied', () => {
      containerEl.scrollTop = 600
      containerEl.scrollHeight = 2000
      containerEl.clientHeight = 500
      const getLogical = vi.fn(() => 4000)
      controller.attach(containerEl, mapEl, null, getLogical)
      onViewportChange.mockClear()

      controller.updateViewport()

      // height = (500 / 4000) * 400 = 50 — uses logical, not native 2000
      expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ height: 50 }))
    })

    it('thumb height stays stable while native scrollHeight oscillates', () => {
      containerEl.scrollTop = 0
      containerEl.clientHeight = 500
      const getLogical = vi.fn(() => 4000) // stable
      controller.attach(containerEl, mapEl, null, getLogical)

      const heights = []
      for (const native of [2000, 2400, 2000, 2400]) {
        containerEl.scrollHeight = native
        onViewportChange.mockClear()
        controller.updateViewport()
        heights.push(onViewportChange.mock.calls.at(-1)[0].height)
      }

      // Logical denominator (4000) holds size constant regardless of native jitter.
      expect(new Set(heights).size).toBe(1)
    })

    it('thumb height falls back to native scrollHeight when getter not supplied', () => {
      containerEl.scrollTop = 500
      containerEl.scrollHeight = 2000
      controller.attach(containerEl, mapEl)
      onViewportChange.mockClear()

      controller.updateViewport()

      // height = (500 / 2000) * 400 = 100 — size falls back to native
      expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ height: 100 }))
    })
  })

  describe('viewport positioning (native scrollHeight for accuracy)', () => {
    // POSITION uses native scrollHeight. The browser caps scrollTop at
    // (nativeScrollHeight - clientHeight); any logical estimate that
    // undercounts native (container padding, per-turn margins, non-turn
    // siblings on long sessions) would let the ratio exceed 1 and push the
    // thumb past mapHeight.

    it('thumb top is 0 when scrollTop is 0', () => {
      containerEl.scrollHeight = 100000
      containerEl.clientHeight = 200
      containerEl.scrollTop = 0
      controller.attach(containerEl, mapEl)

      const viewport = onViewportChange.mock.calls.at(-1)[0]
      expect(viewport.top).toBe(0)
    })

    it('thumb bottom lands at mapHeight at max scroll even when logical undercounts native', () => {
      // Reproduces production divergence: per-turn margins + container padding
      // push native scrollHeight above the logical sum on long sessions.
      containerEl.scrollHeight = 100000 // native (truth)
      containerEl.clientHeight = 200
      containerEl.scrollTop = 99800 // browser cap = nativeScrollHeight - clientHeight
      const getLogical = vi.fn(() => 90000) // undercounts by 10%
      controller.attach(containerEl, mapEl, null, getLogical) // mapHeight = 400

      const viewport = onViewportChange.mock.calls.at(-1)[0]
      expect(viewport.height).toBe(16) // clamped to MINIMAP_MIN_THUMB_HEIGHT
      // Without the native-denominator split, ratio = 99800/89800 > 1 → overshoots 400.
      expect(viewport.top + viewport.height).toBeCloseTo(400, 5)
    })

    it('thumb top never exceeds mapHeight - viewportHeight regardless of logical divergence', () => {
      containerEl.scrollHeight = 100000
      containerEl.clientHeight = 200
      const getLogical = vi.fn(() => 50000) // wildly undercounts
      controller.attach(containerEl, mapEl, null, getLogical)

      for (const scrollTop of [0, 25000, 50000, 75000, 99800]) {
        containerEl.scrollTop = scrollTop
        onViewportChange.mockClear()
        controller.updateViewport()
        const viewport = onViewportChange.mock.calls.at(-1)[0]
        expect(viewport.top + viewport.height).toBeLessThanOrEqual(400)
      }
    })
  })
})
