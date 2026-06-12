/** Tests for useMessageJump hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useMessageJump from './useMessageJump'

/**
 * Create a mock scrollable container with message elements.
 *
 * Uses real DOM elements because the hook calls querySelectorAll.
 */
function createMockContainer(options = {}) {
  const {
    containerTop = 0,
    containerHeight = 500,
    scrollTop = 0,
    scrollHeight = 2000,
    messages = [],
  } = options

  const container = document.createElement('div')
  container.scrollTop = scrollTop
  container.getBoundingClientRect = () => ({
    top: containerTop,
    bottom: containerTop + containerHeight,
    height: containerHeight,
  })

  // jsdom doesn't compute layout - override read-only geometry
  Object.defineProperty(container, 'scrollHeight', { get: () => scrollHeight })
  Object.defineProperty(container, 'clientHeight', { get: () => containerHeight })

  for (const msg of messages) {
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'message-user')
    el.getBoundingClientRect = () => ({
      top: msg.top,
      height: msg.height || 40,
    })
    container.appendChild(el)
  }

  return { container, messagesRef: { current: container } }
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
  })

  describe('jumpPrev', () => {
    it('scrolls to the last message above the viewport', () => {
      const { messagesRef } = createMockContainer({
        containerTop: 200,
        containerHeight: 500,
        messages: [
          { top: 50 }, // above viewport (50 < 200 - 10)
          { top: 100 }, // above viewport (100 < 190)
          { top: 300 }, // inside viewport
        ],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpPrev()
      })

      // scrollToEdge uses rAF
      expect(rafCallbacks.length).toBeGreaterThan(0)
    })

    it('highlights the jumped-to message', () => {
      const { messagesRef, container } = createMockContainer({
        containerTop: 200,
        containerHeight: 500,
        messages: [{ top: 50 }, { top: 300 }],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpPrev()
      })

      const target = container.querySelectorAll('[data-testid="message-user"]')[0]
      expect(target.classList.contains('jump-highlight')).toBe(true)
    })

    it('scrolls to top when no messages are above viewport', () => {
      const { messagesRef, container } = createMockContainer({
        containerTop: 0,
        containerHeight: 500,
        scrollTop: 200,
        messages: [{ top: 100 }, { top: 300 }],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpPrev()
      })

      expect(container.scrollTop).toBe(0)
    })

    it('does nothing with no message elements', () => {
      const { messagesRef } = createMockContainer({
        containerTop: 0,
        containerHeight: 500,
        messages: [],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpPrev()
      })

      expect(rafCallbacks.length).toBe(0)
    })
  })

  describe('jumpNext', () => {
    it('scrolls to the first message below the viewport', () => {
      const { messagesRef } = createMockContainer({
        containerTop: 0,
        containerHeight: 500,
        messages: [
          { top: 100 }, // inside viewport
          { top: 300 }, // inside viewport
          { top: 600 }, // below viewport (600 > 500 - 10)
        ],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpNext()
      })

      expect(rafCallbacks.length).toBeGreaterThan(0)
    })

    it('highlights the jumped-to message', () => {
      const { messagesRef, container } = createMockContainer({
        containerTop: 0,
        containerHeight: 500,
        messages: [{ top: 100 }, { top: 600 }],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpNext()
      })

      const target = container.querySelectorAll('[data-testid="message-user"]')[1]
      expect(target.classList.contains('jump-highlight')).toBe(true)
    })

    it('scrolls to bottom when no messages are below viewport', () => {
      const { messagesRef, container } = createMockContainer({
        containerTop: 0,
        containerHeight: 500,
        scrollTop: 0,
        scrollHeight: 2000,
        messages: [{ top: 100 }, { top: 300 }],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpNext()
      })

      expect(container.scrollTop).toBe(2000)
    })
  })

  describe('jumpTop', () => {
    it('sets scrollTop to 0', () => {
      const { messagesRef, container } = createMockContainer({ scrollTop: 500 })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpTop()
      })

      expect(container.scrollTop).toBe(0)
    })
  })

  describe('jumpBottom', () => {
    it('sets scrollTop to scrollHeight', () => {
      const { messagesRef, container } = createMockContainer({
        scrollTop: 0,
        scrollHeight: 2000,
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpBottom()
      })

      expect(container.scrollTop).toBe(2000)
    })
  })

  describe('highlight lifecycle', () => {
    it('removes highlight class after timeout', () => {
      vi.useFakeTimers()

      const { messagesRef, container } = createMockContainer({
        containerTop: 200,
        containerHeight: 500,
        messages: [{ top: 50 }],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpPrev()
      })

      const target = container.querySelectorAll('[data-testid="message-user"]')[0]
      expect(target.classList.contains('jump-highlight')).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1500)
      })

      expect(target.classList.contains('jump-highlight')).toBe(false)

      vi.useRealTimers()
    })

    it('clears previous highlight when new jump fires before timeout', () => {
      vi.useFakeTimers()

      const { messagesRef, container } = createMockContainer({
        containerTop: 300,
        containerHeight: 500,
        messages: [{ top: 50 }, { top: 150 }],
      })

      const { result } = renderHook(() => useMessageJump(messagesRef))

      act(() => {
        result.current.jumpPrev()
      })

      const msg0 = container.querySelectorAll('[data-testid="message-user"]')[0]
      const msg1 = container.querySelectorAll('[data-testid="message-user"]')[1]
      expect(msg1.classList.contains('jump-highlight')).toBe(true)

      // Move msg1 into viewport so msg0 becomes the only target above
      msg1.getBoundingClientRect = () => ({ top: 350, height: 40 })

      act(() => {
        result.current.jumpPrev()
      })

      expect(msg1.classList.contains('jump-highlight')).toBe(false)
      expect(msg0.classList.contains('jump-highlight')).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('null ref safety', () => {
    it('jumpPrev does not throw with null ref', () => {
      const messagesRef = { current: null }
      const { result } = renderHook(() => useMessageJump(messagesRef))

      expect(() => {
        act(() => {
          result.current.jumpPrev()
        })
      }).not.toThrow()
    })

    it('jumpNext does not throw with null ref', () => {
      const messagesRef = { current: null }
      const { result } = renderHook(() => useMessageJump(messagesRef))

      expect(() => {
        act(() => {
          result.current.jumpNext()
        })
      }).not.toThrow()
    })

    it('jumpTop does not throw with null ref', () => {
      const messagesRef = { current: null }
      const { result } = renderHook(() => useMessageJump(messagesRef))

      expect(() => {
        act(() => {
          result.current.jumpTop()
        })
      }).not.toThrow()
    })

    it('jumpBottom does not throw with null ref', () => {
      const messagesRef = { current: null }
      const { result } = renderHook(() => useMessageJump(messagesRef))

      expect(() => {
        act(() => {
          result.current.jumpBottom()
        })
      }).not.toThrow()
    })
  })

  describe('autoscroll engagement transitions', () => {
    // Order-capturing factory so each test asserts the temporal ordering of
    // intent/returned/programmatic relative to the scroll write itself - not
    // just "was called".
    function withOrder() {
      const order = []
      const tag = name =>
        vi.fn(() => {
          order.push(name)
        })
      return {
        order,
        markUserIntent: tag('intent'),
        markReturnedToBottom: tag('returned'),
        markProgrammaticScroll: tag('programmatic'),
      }
    }

    function attachScrollSpy(container, order) {
      let scrollTopBacking = container.scrollTop
      Object.defineProperty(container, 'scrollTop', {
        configurable: true,
        get: () => scrollTopBacking,
        set: v => {
          scrollTopBacking = v
          order.push('scroll')
        },
      })
    }

    it('jumpPrev calls markUserIntent + markProgrammaticScroll before scroll', () => {
      const { order, markUserIntent, markReturnedToBottom, markProgrammaticScroll } = withOrder()
      const { messagesRef, container } = createMockContainer({
        containerTop: 200,
        containerHeight: 500,
        messages: [{ top: 50 }, { top: 300 }],
      })
      attachScrollSpy(container, order)

      const { result } = renderHook(() =>
        useMessageJump(messagesRef, markProgrammaticScroll, markUserIntent, markReturnedToBottom),
      )

      act(() => {
        result.current.jumpPrev()
      })

      expect(markUserIntent).toHaveBeenCalledOnce()
      expect(markProgrammaticScroll).toHaveBeenCalledOnce()
      expect(markReturnedToBottom).not.toHaveBeenCalled()
      expect(order.indexOf('intent')).toBeLessThan(order.indexOf('programmatic'))
      // scrollToEdge uses rAF so no scroll write occurs synchronously here -
      // the ordering invariant is intent < programmatic, both before any later
      // rAF callback runs.
    })

    it('jumpTop calls markUserIntent + markProgrammaticScroll before scroll', () => {
      const { order, markUserIntent, markReturnedToBottom, markProgrammaticScroll } = withOrder()
      const { messagesRef, container } = createMockContainer({ scrollTop: 500 })
      attachScrollSpy(container, order)

      const { result } = renderHook(() =>
        useMessageJump(messagesRef, markProgrammaticScroll, markUserIntent, markReturnedToBottom),
      )

      act(() => {
        result.current.jumpTop()
      })

      expect(markUserIntent).toHaveBeenCalledOnce()
      expect(markProgrammaticScroll).toHaveBeenCalledOnce()
      expect(markReturnedToBottom).not.toHaveBeenCalled()
      expect(order).toEqual(['intent', 'programmatic', 'scroll'])
    })

    it('jumpBottom calls markReturnedToBottom + markProgrammaticScroll before scroll', () => {
      const { order, markUserIntent, markReturnedToBottom, markProgrammaticScroll } = withOrder()
      const { messagesRef, container } = createMockContainer({ scrollTop: 0, scrollHeight: 2000 })
      attachScrollSpy(container, order)

      const { result } = renderHook(() =>
        useMessageJump(messagesRef, markProgrammaticScroll, markUserIntent, markReturnedToBottom),
      )

      act(() => {
        result.current.jumpBottom()
      })

      expect(markReturnedToBottom).toHaveBeenCalledOnce()
      expect(markProgrammaticScroll).toHaveBeenCalledOnce()
      expect(markUserIntent).not.toHaveBeenCalled()
      expect(order).toEqual(['returned', 'programmatic', 'scroll'])
    })

    it('jumpNext mid-list (target inside viewport-below) calls markUserIntent + markProgrammaticScroll', () => {
      const { order, markUserIntent, markReturnedToBottom, markProgrammaticScroll } = withOrder()
      const { messagesRef, container } = createMockContainer({
        containerTop: 0,
        containerHeight: 500,
        messages: [{ top: 100 }, { top: 600 }],
      })
      attachScrollSpy(container, order)

      const { result } = renderHook(() =>
        useMessageJump(messagesRef, markProgrammaticScroll, markUserIntent, markReturnedToBottom),
      )

      act(() => {
        result.current.jumpNext()
      })

      expect(markUserIntent).toHaveBeenCalledOnce()
      expect(markProgrammaticScroll).toHaveBeenCalledOnce()
      expect(markReturnedToBottom).not.toHaveBeenCalled()
      expect(order.indexOf('intent')).toBeLessThan(order.indexOf('programmatic'))
    })

    it('jumpNext fall-through (no message below viewport) calls markReturnedToBottom + markProgrammaticScroll', () => {
      const { order, markUserIntent, markReturnedToBottom, markProgrammaticScroll } = withOrder()
      const { messagesRef, container } = createMockContainer({
        containerTop: 0,
        containerHeight: 500,
        scrollHeight: 2000,
        messages: [{ top: 100 }, { top: 300 }],
      })
      attachScrollSpy(container, order)

      const { result } = renderHook(() =>
        useMessageJump(messagesRef, markProgrammaticScroll, markUserIntent, markReturnedToBottom),
      )

      act(() => {
        result.current.jumpNext()
      })

      expect(markReturnedToBottom).toHaveBeenCalledOnce()
      expect(markProgrammaticScroll).toHaveBeenCalledOnce()
      expect(markUserIntent).not.toHaveBeenCalled()
      expect(order).toEqual(['returned', 'programmatic', 'scroll'])
    })
  })
})
