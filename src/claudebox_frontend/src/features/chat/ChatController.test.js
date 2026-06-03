/** Tests for ChatController class. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatController from './ChatController'

describe('ChatController', () => {
  let controller
  let mockMessagesEl
  let mockPanelEl
  let rafCallbacks

  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })

    // Mock DOM elements
    mockMessagesEl = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockPanelEl = {
      offsetHeight: 600,
    }

    controller = new ChatController()
  })

  afterEach(() => {
    controller.dispose()
    vi.unstubAllGlobals()
  })

  function flushRAF() {
    const cbs = rafCallbacks.splice(0)
    for (const cb of cbs) {
      cb()
    }
  }

  describe('initialization', () => {
    it('initializes with default state', () => {
      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.isProgrammaticScroll).toBe(false)
    })

    it('accepts element refs on initialize', () => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      expect(controller.elements.messagesEl).toBe(mockMessagesEl)
      expect(controller.elements.panelEl).toBe(mockPanelEl)
    })
  })

  describe('autoscroll', () => {
    beforeEach(() => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })
    })

    it('scrollToBottom scrolls when enabled', () => {
      controller.isAutoScrollEnabled = true
      controller.scrollToBottom()
      flushRAF()

      expect(mockMessagesEl.scrollTop).toBe(mockMessagesEl.scrollHeight)
    })

    it('scrollToBottom no-op when disabled', () => {
      controller.isAutoScrollEnabled = false
      mockMessagesEl.scrollTop = 100

      controller.scrollToBottom()

      expect(mockMessagesEl.scrollTop).toBe(100)
    })

    it('disables autoscroll on markUserIntent (input-source intent)', () => {
      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 200 // Not at bottom

      controller.markUserIntent()

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
    })

    it('handleUserScroll alone does not disable autoscroll (intent comes from input listeners)', () => {
      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 200

      controller.handleUserScroll()

      expect(controller.isAutoScrollEnabled).toBe(true)
    })

    it('re-enables autoscroll when user scrolls back to bottom after expressing intent', () => {
      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 200

      controller.markUserIntent()
      expect(controller.isAutoScrollEnabled).toBe(false)

      mockMessagesEl.scrollTop = 500 // At bottom
      controller.handleUserScroll()

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)
    })

    it('does not re-enable on isAtBottom without prior intent latch', () => {
      controller.isAutoScrollEnabled = false
      controller.userIntentActive = false
      mockMessagesEl.scrollTop = 500 // At bottom

      controller.handleUserScroll()

      expect(controller.isAutoScrollEnabled).toBe(false)
    })

    it('ignores programmatic scroll for re-engagement check', () => {
      controller.isAutoScrollEnabled = false
      controller.userIntentActive = true
      controller.isProgrammaticScroll = true
      mockMessagesEl.scrollTop = 500

      controller.handleUserScroll()

      // Programmatic scrolls do not re-engage autoscroll
      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
    })

    it('wheel listener: downward wheel at bottom does not latch intent', () => {
      // Within AUTOSCROLL_THRESHOLD (50px) of bottom + deltaY > 0: the view
      // cannot move; this is a no-op gesture, not intent. The listener must
      // gate before reaching markUserIntent.
      const listeners = {}
      const realEl = {
        scrollTop: 460, // distFromBottom = 40, at-bottom
        scrollHeight: 1000,
        clientHeight: 500,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
        removeEventListener: () => {},
      }
      const onAutoScrollChange = vi.fn()
      controller = new ChatController({ onAutoScrollChange })
      controller.initialize({ messagesEl: realEl, panelEl: mockPanelEl })
      controller.attachInputListeners(realEl)
      controller.isAutoScrollEnabled = true

      listeners.wheel({ deltaY: 5, ctrlKey: false })

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)
      expect(onAutoScrollChange).not.toHaveBeenCalled()
    })

    it('wheel listener: upward wheel at bottom latches intent', () => {
      // Upward wheel (deltaY < 0) at-bottom is genuine intent — view will
      // move away from bottom — so the listener must NOT gate.
      const listeners = {}
      const realEl = {
        scrollTop: 460, // at-bottom
        scrollHeight: 1000,
        clientHeight: 500,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
        removeEventListener: () => {},
      }
      const onAutoScrollChange = vi.fn()
      controller = new ChatController({ onAutoScrollChange })
      controller.initialize({ messagesEl: realEl, panelEl: mockPanelEl })
      controller.attachInputListeners(realEl)
      controller.isAutoScrollEnabled = true

      listeners.wheel({ deltaY: -5, ctrlKey: false })

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
      expect(onAutoScrollChange).toHaveBeenCalledWith(false)
    })

    it('wheel listener: downward wheel above threshold latches intent', () => {
      // Above AUTOSCROLL_THRESHOLD: any wheel direction is real intent. This
      // preserves the input-source disengage contract from the prior rework.
      const listeners = {}
      const realEl = {
        scrollTop: 200, // distFromBottom = 300, above threshold
        scrollHeight: 1000,
        clientHeight: 500,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
        removeEventListener: () => {},
      }
      const onAutoScrollChange = vi.fn()
      controller = new ChatController({ onAutoScrollChange })
      controller.initialize({ messagesEl: realEl, panelEl: mockPanelEl })
      controller.attachInputListeners(realEl)
      controller.isAutoScrollEnabled = true

      listeners.wheel({ deltaY: 5, ctrlKey: false })

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
      expect(onAutoScrollChange).toHaveBeenCalledWith(false)
    })

    it('keydown listener: scroll-down keys at bottom do not latch intent', () => {
      // PageDown / End / ArrowDown / unshifted Space at-bottom: view cannot
      // move — no intent. The listener must filter these.
      const listeners = {}
      const realEl = {
        scrollTop: 460, // at-bottom
        scrollHeight: 1000,
        clientHeight: 500,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
        removeEventListener: () => {},
      }
      const onAutoScrollChange = vi.fn()
      controller = new ChatController({ onAutoScrollChange })
      controller.initialize({ messagesEl: realEl, panelEl: mockPanelEl })
      controller.attachInputListeners(realEl)
      controller.isAutoScrollEnabled = true

      for (const key of ['PageDown', 'End', 'ArrowDown', ' ']) {
        listeners.keydown({ key, shiftKey: false, target: realEl })
      }

      expect(controller.isAutoScrollEnabled).toBe(true)
      expect(controller.userIntentActive).toBe(false)
      expect(onAutoScrollChange).not.toHaveBeenCalled()
    })

    it('keydown listener: scroll-up keys at bottom latch intent', () => {
      // PageUp / Home / ArrowUp / Shift+Space at-bottom: view will move up —
      // genuine intent. The listener must pass these through.
      const listeners = {}
      const realEl = {
        scrollTop: 460, // at-bottom
        scrollHeight: 1000,
        clientHeight: 500,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
        removeEventListener: () => {},
      }
      const onAutoScrollChange = vi.fn()
      controller = new ChatController({ onAutoScrollChange })
      controller.initialize({ messagesEl: realEl, panelEl: mockPanelEl })
      controller.attachInputListeners(realEl)
      controller.isAutoScrollEnabled = true

      listeners.keydown({ key: 'ArrowUp', shiftKey: false, target: realEl })

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(controller.userIntentActive).toBe(true)
      expect(onAutoScrollChange).toHaveBeenCalledWith(false)
    })

    it('monotonically re-engages exactly once during scroll-to-bottom sweep with interleaved wheel events', () => {
      // Sweep scrollTop from 200 to 500 in 5px steps; at each step dispatch a
      // downward wheel (deltaY > 0) through the actual wheel listener,
      // followed by the React onScroll (handleUserScroll). User scenario:
      // previously latched (above threshold), now scrolling back DOWN toward
      // bottom. Contract: zero per-tick disable/enable flicker.
      const listeners = {}
      const realEl = {
        scrollTop: 200,
        scrollHeight: 1000,
        clientHeight: 500,
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
        removeEventListener: () => {},
      }
      const callbacks = []
      controller = new ChatController({
        onAutoScrollChange: value => callbacks.push({ at: realEl.scrollTop, value }),
      })
      controller.initialize({ messagesEl: realEl, panelEl: mockPanelEl })
      controller.attachInputListeners(realEl)
      controller.isAutoScrollEnabled = true

      // Precondition: latch via an upward wheel at scrollTop=200 (above threshold).
      listeners.wheel({ deltaY: -5, ctrlKey: false })
      expect(controller.isAutoScrollEnabled).toBe(false)

      const tuples = []
      for (let st = 200; st <= 500; st += 5) {
        realEl.scrollTop = st
        listeners.wheel({ deltaY: 5, ctrlKey: false }) // downward wheel via listener
        controller.handleUserScroll()
        tuples.push({ scrollTop: st, enabled: controller.isAutoScrollEnabled })
      }

      // Post-step transitions: exactly one false -> true, zero true -> false.
      const transitions = []
      for (let i = 1; i < tuples.length; i += 1) {
        if (tuples[i - 1].enabled !== tuples[i].enabled) {
          transitions.push({
            at: tuples[i].scrollTop,
            from: tuples[i - 1].enabled,
            to: tuples[i].enabled,
          })
        }
      }
      const falseToTrue = transitions.filter(t => t.from === false && t.to === true)
      const trueToFalse = transitions.filter(t => t.from === true && t.to === false)
      expect(falseToTrue).toHaveLength(1)
      expect(trueToFalse).toHaveLength(0)

      // Callback stream after the initial precondition disengage: exactly one
      // true fire, zero false fires. Pre-fix the per-tick listener
      // unconditionally re-latched, fighting handleUserScroll's re-engage on
      // every wheel tick within the at-bottom zone.
      const sweepCallbacks = callbacks.slice(1)
      const trueFires = sweepCallbacks.filter(c => c.value === true)
      const falseFires = sweepCallbacks.filter(c => c.value === false)
      expect(trueFires).toHaveLength(1)
      expect(falseFires).toHaveLength(0)

      // Final state at the end of the sweep is engaged.
      expect(tuples[tuples.length - 1].enabled).toBe(true)
    })
  })

  describe('isAtBottom detection', () => {
    beforeEach(() => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })
    })

    it('returns true when scrolled to bottom', () => {
      mockMessagesEl.scrollTop = 500 // scrollHeight - clientHeight

      expect(controller.isAtBottom()).toBe(true)
    })

    it('returns true within threshold', () => {
      mockMessagesEl.scrollTop = 460 // Within 50px threshold

      expect(controller.isAtBottom()).toBe(true)
    })

    it('returns false when scrolled up', () => {
      mockMessagesEl.scrollTop = 200

      expect(controller.isAtBottom()).toBe(false)
    })
  })

  describe('event coordination', () => {
    beforeEach(() => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })
    })

    it('scrolls on events change when at bottom', () => {
      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 500

      controller.onEventsChange([{ type: 'user' }])
      flushRAF()

      expect(mockMessagesEl.scrollTop).toBe(mockMessagesEl.scrollHeight)
    })

    it('does not scroll on events change when scrolled up', () => {
      controller.isAutoScrollEnabled = false
      mockMessagesEl.scrollTop = 200

      controller.onEventsChange([{ type: 'user' }])

      expect(mockMessagesEl.scrollTop).toBe(200)
    })
  })

  describe('dispose', () => {
    it('cleans up without error', () => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      expect(() => controller.dispose()).not.toThrow()
    })

    it('can be called multiple times safely', () => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      controller.dispose()
      expect(() => controller.dispose()).not.toThrow()
    })
  })

  describe('restoreState', () => {
    it('restores enabled state', () => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      controller.restoreState({ enabled: false })

      expect(controller.isAutoScrollEnabled).toBe(false)
    })

    it('restores scroll position when messagesEl exists', () => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      controller.restoreState({ scrollPosition: 250 })

      expect(mockMessagesEl.scrollTop).toBe(250)
    })

    it('restores both enabled and scrollPosition together', () => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      controller.restoreState({ enabled: false, scrollPosition: 300 })

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(mockMessagesEl.scrollTop).toBe(300)
    })

    it('skips scrollPosition when messagesEl is null', () => {
      // No initialize call, so messagesEl is null
      expect(() => {
        controller.restoreState({ scrollPosition: 100 })
      }).not.toThrow()
    })

    it('ignores undefined values', () => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      controller.isAutoScrollEnabled = false
      mockMessagesEl.scrollTop = 200

      controller.restoreState({})

      expect(controller.isAutoScrollEnabled).toBe(false)
      expect(mockMessagesEl.scrollTop).toBe(200)
    })
  })

  describe('onPendingMessagesChange', () => {
    beforeEach(() => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })
    })

    it('scrolls to bottom when autoscroll is enabled', () => {
      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 0

      controller.onPendingMessagesChange([{ id: 1, text: 'pending' }])
      flushRAF()

      expect(mockMessagesEl.scrollTop).toBe(mockMessagesEl.scrollHeight)
    })

    it('does not scroll when autoscroll is disabled', () => {
      controller.isAutoScrollEnabled = false
      mockMessagesEl.scrollTop = 200

      controller.onPendingMessagesChange([{ id: 1, text: 'pending' }])

      expect(mockMessagesEl.scrollTop).toBe(200)
    })
  })

  describe('null element guards', () => {
    it('isAtBottom returns true when messagesEl is null', () => {
      // No initialize, elements.messagesEl is null
      expect(controller.isAtBottom()).toBe(true)
    })

    it('scrollToBottom returns gracefully when messagesEl is null', () => {
      controller.isAutoScrollEnabled = true

      expect(() => {
        controller.scrollToBottom()
      }).not.toThrow()
    })

    it('handleUserScroll returns gracefully when messagesEl is null', () => {
      expect(() => {
        controller.handleUserScroll()
      }).not.toThrow()
    })
  })

  describe('attachResizeObserver', () => {
    let resizeCallback
    let mockContainerEl
    let contextRefs

    beforeEach(() => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb) {
            resizeCallback = cb
          }
          observe() {}
          disconnect() {}
        },
      )

      mockContainerEl = {
        scrollTop: 300,
        scrollHeight: 1000,
        clientHeight: 500,
      }

      contextRefs = {
        chatAutoScrollEnabledRef: { current: false },
        chatScrollPositionRef: { current: 300 },
      }
    })

    it('restores saved scroll position on resize when autoscroll disabled', () => {
      controller.isAutoScrollEnabled = false
      controller.attachResizeObserver(mockContainerEl, contextRefs)

      // Simulate browser resetting scrollTop (e.g., panel activation)
      mockContainerEl.scrollTop = 0

      resizeCallback([{ contentRect: { height: 500 } }])
      flushRAF()

      // Should restore from chatScrollPositionRef
      expect(mockContainerEl.scrollTop).toBe(300)
    })

    it('restores scroll position on content change when autoscroll disabled', () => {
      controller.isAutoScrollEnabled = false
      controller.attachResizeObserver(mockContainerEl, contextRefs)

      // Simulate content change — contentRect height grows alongside scrollHeight.
      mockContainerEl.scrollHeight = 1500

      resizeCallback([{ contentRect: { height: 600 } }])
      flushRAF()

      // With autoscroll disabled, should restore saved position
      expect(mockContainerEl.scrollTop).toBe(300)
    })

    it('scrolls to bottom on content change when autoscroll is enabled', () => {
      controller.isAutoScrollEnabled = true
      controller.attachResizeObserver(mockContainerEl, contextRefs)

      // Simulate content change — contentRect height grows alongside scrollHeight.
      mockContainerEl.scrollHeight = 1500

      resizeCallback([{ contentRect: { height: 600 } }])
      flushRAF()

      expect(mockContainerEl.scrollTop).toBe(1500)
    })

    it('no-ops when containerEl is null', () => {
      expect(() => {
        controller.attachResizeObserver(null, contextRefs)
      }).not.toThrow()
    })

    it('skips scroll restoration when contentRect.height is unchanged across observer firings', () => {
      // Width-only reflows (e.g. tab-row layout shift after panel.api.setTitle
      // during rename) fire the ResizeObserver with the same contentRect.height.
      // Restoring scroll on every firing destroys the user's place when
      // contextRefs.chatScrollPositionRef holds a stale value (0 in the failing
      // path during streaming bursts). The observer must bail when the height
      // is unchanged so unrelated reflows are no-ops.
      controller.isAutoScrollEnabled = false
      controller.attachResizeObserver(mockContainerEl, contextRefs)

      // First firing — height differs from sentinel; observer must restore.
      mockContainerEl.scrollTop = 0
      resizeCallback([{ contentRect: { height: 500 } }])
      flushRAF()
      expect(mockContainerEl.scrollTop).toBe(300)

      // Simulate a width-only reflow: browser briefly resets scrollTop, observer
      // fires with the SAME height. Bail must preserve the new position.
      mockContainerEl.scrollTop = 50
      resizeCallback([{ contentRect: { height: 500 } }])
      flushRAF()
      expect(mockContainerEl.scrollTop).toBe(50)

      // Genuine height change (content grew) still triggers restoration.
      mockContainerEl.scrollTop = 0
      resizeCallback([{ contentRect: { height: 700 } }])
      flushRAF()
      expect(mockContainerEl.scrollTop).toBe(300)
    })
  })

  describe('rAF scroll coalescing', () => {
    beforeEach(() => {
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })
    })

    it('coalesces multiple scrollToBottom calls into a single rAF and one DOM write', () => {
      const rafSpy = vi.fn(cb => {
        rafCallbacks.push(cb)
        return rafCallbacks.length
      })
      vi.stubGlobal('requestAnimationFrame', rafSpy)

      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 0

      // Track scrollTop writes directly.
      let writes = 0
      let stored = 0
      Object.defineProperty(mockMessagesEl, 'scrollTop', {
        configurable: true,
        get() {
          return stored
        },
        set(v) {
          stored = v
          writes += 1
        },
      })

      // 5 synchronous calls within the same frame
      controller.scrollToBottom()
      controller.scrollToBottom()
      controller.scrollToBottom()
      controller.scrollToBottom()
      controller.scrollToBottom()

      // Only one rAF scheduled
      expect(rafSpy).toHaveBeenCalledTimes(1)

      // Flush the single scheduled callback
      flushRAF()

      // The actual scroll write happens exactly once
      expect(writes).toBe(1)
      expect(stored).toBe(mockMessagesEl.scrollHeight)
    })
  })

  describe('state persistence callbacks', () => {
    it('calls onAutoScrollChange(false) when user expresses scroll intent', () => {
      const onAutoScrollChange = vi.fn()
      controller = new ChatController({ onAutoScrollChange })
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 200

      controller.markUserIntent()

      expect(onAutoScrollChange).toHaveBeenCalledWith(false)
    })

    it('calls onAutoScrollChange(true) when user scrolls back to bottom after intent', () => {
      const onAutoScrollChange = vi.fn()
      controller = new ChatController({ onAutoScrollChange })
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      controller.isAutoScrollEnabled = true
      mockMessagesEl.scrollTop = 200
      controller.markUserIntent()
      onAutoScrollChange.mockClear()

      mockMessagesEl.scrollTop = 500 // At bottom
      controller.handleUserScroll()

      expect(onAutoScrollChange).toHaveBeenCalledWith(true)
    })

    it('calls onScrollPositionChange when scroll position changes', () => {
      const onScrollPositionChange = vi.fn()
      controller = new ChatController({ onScrollPositionChange })
      controller.initialize({
        messagesEl: mockMessagesEl,
        panelEl: mockPanelEl,
      })

      mockMessagesEl.scrollTop = 300
      controller.handleUserScroll()

      expect(onScrollPositionChange).toHaveBeenCalledWith(300)
    })
  })
})
