/** Tests for ColumnScrollController class. */

import { describe, expect, it, vi } from 'vitest'
import ColumnScrollController from './ColumnScrollController'

/** A minimal scrollable-element stand-in, matching the shape ChatController.test.js uses. */
function mockElement(overrides = {}) {
  return {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides,
  }
}

describe('ColumnScrollController', () => {
  it('initializes with autoscroll engaged', () => {
    const controller = new ColumnScrollController()
    expect(controller.isAutoScrollEnabled).toBe(true)
    expect(controller.userIntentActive).toBe(false)
  })

  describe('scrollToBottom', () => {
    it('scrolls to the bottom when engaged', () => {
      const controller = new ColumnScrollController()
      const el = mockElement({ scrollTop: 100 })
      controller.initialize(el)

      controller.scrollToBottom()

      expect(el.scrollTop).toBe(el.scrollHeight)
    })

    it('is a no-op when disengaged', () => {
      const controller = new ColumnScrollController()
      const el = mockElement({ scrollTop: 100 })
      controller.initialize(el)
      controller.isAutoScrollEnabled = false

      controller.scrollToBottom()

      expect(el.scrollTop).toBe(100)
    })

    it('is a no-op before initialize', () => {
      const controller = new ColumnScrollController()
      expect(() => controller.scrollToBottom()).not.toThrow()
    })
  })

  describe('markUserIntent / markReturnedToBottom', () => {
    it('disengages autoscroll and latches intent', () => {
      const onAutoScrollChange = vi.fn()
      const controller = new ColumnScrollController({ onAutoScrollChange })
      controller.initialize(mockElement())

      controller.markUserIntent()

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
      expect(onAutoScrollChange).toHaveBeenCalledWith(false)
    })

    it('re-engages and clears the latch', () => {
      const onAutoScrollChange = vi.fn()
      const controller = new ColumnScrollController({ onAutoScrollChange })
      controller.initialize(mockElement())
      controller.markUserIntent()

      controller.markReturnedToBottom()

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)
      expect(onAutoScrollChange).toHaveBeenCalledWith(true)
    })
  })

  describe('markProgrammaticScroll', () => {
    it('brackets an external scroll write so handleScroll does not re-engage autoscroll', () => {
      // Mirrors useColumnStep.goToElement's call order: disengage, bracket, then a scrollTop write
      // landing within the threshold - unbracketed, its scroll event re-engages in the same tick.
      const controller = new ColumnScrollController()
      const el = mockElement({ scrollTop: 200 })
      controller.initialize(el)
      controller.markUserIntent()
      expect(controller.isAutoScrollEnabled).toBe(false)

      controller.markProgrammaticScroll()
      el.scrollTop = 460 // distFromBottom = 40, within threshold
      controller.handleScroll()

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
    })

    it('is a no-op before initialize', () => {
      const controller = new ColumnScrollController()
      expect(() => controller.markProgrammaticScroll()).not.toThrow()
    })
  })

  describe('handleScroll', () => {
    it('re-engages once the user manually scrolls back to the bottom after intent', () => {
      const controller = new ColumnScrollController()
      const el = mockElement({ scrollTop: 200 })
      controller.initialize(el)
      controller.markUserIntent()
      expect(controller.isAutoScrollEnabled).toBe(false)

      el.scrollTop = 460 // distFromBottom = 40, within threshold
      controller.handleScroll()

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)
    })

    it('never disengages on its own - only the input listeners latch intent', () => {
      const controller = new ColumnScrollController()
      const el = mockElement({ scrollTop: 200 })
      controller.initialize(el)

      controller.handleScroll()

      expect(controller.isAutoScrollEnabled).toBe(true)
    })

    it('ignores position while a programmatic scroll is in flight', () => {
      const controller = new ColumnScrollController()
      const el = mockElement({ scrollTop: 460 })
      controller.initialize(el)
      controller.markUserIntent()
      controller.isProgrammaticScroll = true

      controller.handleScroll()

      expect(controller.isAutoScrollEnabled).toBe(false)
    })
  })

  describe('reset', () => {
    it('re-engages and clears the latch regardless of prior state', () => {
      const onAutoScrollChange = vi.fn()
      const controller = new ColumnScrollController({ onAutoScrollChange })
      controller.initialize(mockElement())
      controller.markUserIntent()

      controller.reset()

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)
      expect(onAutoScrollChange).toHaveBeenLastCalledWith(true)
    })
  })

  describe('isAtBottom', () => {
    it('is true within the autoscroll threshold', () => {
      const controller = new ColumnScrollController()
      controller.initialize(mockElement({ scrollTop: 460 })) // distFromBottom = 40
      expect(controller.isAtBottom()).toBe(true)
    })

    it('is false beyond the threshold', () => {
      const controller = new ColumnScrollController()
      controller.initialize(mockElement({ scrollTop: 200 })) // distFromBottom = 300
      expect(controller.isAtBottom()).toBe(false)
    })

    it('is true before initialize (no element to measure)', () => {
      const controller = new ColumnScrollController()
      expect(controller.isAtBottom()).toBe(true)
    })
  })

  describe('attachInputListeners', () => {
    it('wheel listener: downward wheel at bottom is a no-op, not intent', () => {
      const listeners = {}
      const el = mockElement({
        scrollTop: 460,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
      })
      const onAutoScrollChange = vi.fn()
      const controller = new ColumnScrollController({ onAutoScrollChange })
      controller.initialize(el)
      controller.attachInputListeners(el)

      listeners.wheel({ deltaY: 5, ctrlKey: false })

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(onAutoScrollChange).not.toHaveBeenCalled()
    })

    it('wheel listener: upward wheel at bottom latches intent', () => {
      const listeners = {}
      const el = mockElement({
        scrollTop: 460,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
      })
      const controller = new ColumnScrollController()
      controller.initialize(el)
      controller.attachInputListeners(el)

      listeners.wheel({ deltaY: -5, ctrlKey: false })

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
    })

    it('wheel listener: a horizontally-scrollable nested block consumes the gesture', () => {
      const listeners = {}
      const nested = {
        nodeType: 1,
        parentElement: null,
        scrollLeft: 0,
        clientWidth: 100,
        scrollWidth: 300,
      }
      const el = mockElement({
        scrollTop: 200,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
      })
      nested.parentElement = el
      const originalGetComputedStyle = window.getComputedStyle
      window.getComputedStyle = node =>
        node === nested
          ? { overflowX: 'auto', overflowY: 'visible' }
          : { overflowX: 'visible', overflowY: 'visible' }

      const controller = new ColumnScrollController()
      controller.initialize(el)
      controller.attachInputListeners(el)

      listeners.wheel({ deltaX: 5, deltaY: 0, ctrlKey: false, target: nested })

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)

      window.getComputedStyle = originalGetComputedStyle
    })

    it('keydown listener: scroll-down keys at bottom do not latch intent', () => {
      const listeners = {}
      const el = mockElement({
        scrollTop: 460,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
      })
      const controller = new ColumnScrollController()
      controller.initialize(el)
      controller.attachInputListeners(el)

      for (const key of ['PageDown', 'End', 'ArrowDown', ' ']) {
        listeners.keydown({ key, shiftKey: false, target: el })
      }

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)
    })

    it('keydown listener: ignores keys typed into a text field', () => {
      const listeners = {}
      const el = mockElement({
        scrollTop: 200,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
      })
      const controller = new ColumnScrollController()
      controller.initialize(el)
      controller.attachInputListeners(el)

      listeners.keydown({ key: 'ArrowUp', shiftKey: false, target: { matches: () => true } })

      expect(controller.userIntentActive).toBe(false)
    })
  })

  describe('dispose', () => {
    it('removes every attached listener', () => {
      const el = mockElement()
      const controller = new ColumnScrollController()
      controller.initialize(el)
      controller.attachInputListeners(el)

      controller.dispose()

      expect(el.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function))
      expect(el.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function))
      expect(el.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
      expect(el.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
    })
  })
})
