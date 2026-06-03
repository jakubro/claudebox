/** Tests for useTextareaResize hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useTextareaResize from './useTextareaResize'

describe('useTextareaResize', () => {
  let resizeCallbacks = []

  beforeEach(() => {
    resizeCallbacks = []
    vi.stubGlobal(
      'ResizeObserver',
      class MockResizeObserver {
        constructor(callback) {
          resizeCallbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * Create mock textarea element.
   */
  function createMockTextarea(scrollHeight = 50) {
    return {
      style: { height: '', overflowY: '' },
      scrollHeight,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  }

  /**
   * Create mock panel element.
   */
  function createMockPanel(clientHeight = 400) {
    return { clientHeight }
  }

  /**
   * Create mock messages container.
   */
  function createMockMessages(scrollTop = 0) {
    return { scrollTop }
  }

  /**
   * Create refs for the hook with given mock elements.
   */
  function createRefs(textarea, panel, messages = createMockMessages(), autoScroll = true) {
    return {
      textareaRef: { current: textarea },
      panelRef: { current: panel },
      messagesRef: { current: messages },
      isAutoScrollEnabledRef: { current: autoScroll },
    }
  }

  /**
   * Trigger all ResizeObserver callbacks.
   */
  function triggerResize() {
    act(() => {
      for (const cb of resizeCallbacks) {
        cb()
      }
    })
  }

  it('resizeTextarea() sets height to scrollHeight', () => {
    const textarea = createMockTextarea(80)
    const panel = createMockPanel(400)
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
    )

    const { result } = renderHook(() =>
      useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef),
    )

    act(() => {
      result.current.resizeTextarea()
    })

    expect(textarea.style.height).toBe('80px')
  })

  it('caps height at 33% of panel height', () => {
    const textarea = createMockTextarea(500) // scrollHeight exceeds max
    const panel = createMockPanel(400) // max = 400 * 0.33 = 132
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
    )

    renderHook(() => useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef))

    triggerResize()

    expect(textarea.style.height).toBe('132px')
  })

  it('sets overflowY to auto when at max height', () => {
    const textarea = createMockTextarea(500)
    const panel = createMockPanel(400) // max = 132
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
    )

    renderHook(() => useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef))

    triggerResize()

    expect(textarea.style.overflowY).toBe('auto')
  })

  it('sets overflowY to hidden when below max height', () => {
    const textarea = createMockTextarea(100)
    const panel = createMockPanel(400) // max = 132
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
    )

    renderHook(() => useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef))

    triggerResize()

    expect(textarea.style.overflowY).toBe('hidden')
  })

  it('compensates chat scroll when textarea grows (if user scrolled up)', () => {
    const textarea = createMockTextarea(50)
    const panel = createMockPanel(400)
    const messages = createMockMessages(100)
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
      messages,
      false, // User scrolled up
    )

    const { result } = renderHook(() =>
      useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef),
    )

    triggerResize()

    // Capture scroll position after stabilization
    const scrollBefore = messages.scrollTop

    // Textarea grows
    textarea.scrollHeight = 100
    act(() => {
      result.current.resizeTextarea()
    })

    // scrollTop should increase by height difference (100 - 50 = 50)
    expect(messages.scrollTop).toBe(scrollBefore + 50)
  })

  it('scrolls to bottom when textarea grows with autoscroll enabled', () => {
    const textarea = createMockTextarea(50)
    const panel = createMockPanel(400)
    const messages = createMockMessages(100)
    messages.scrollHeight = 1000
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
      messages,
      true, // Autoscroll engaged
    )

    const { result } = renderHook(() =>
      useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef),
    )

    // First resize to establish prevHeight
    act(() => {
      result.current.resizeTextarea()
    })

    // Textarea grows
    textarea.scrollHeight = 100
    act(() => {
      result.current.resizeTextarea()
    })

    // Should pin to bottom (scrollTop = scrollHeight)
    expect(messages.scrollTop).toBe(1000)
  })

  it('updates max height when panel resizes', () => {
    const textarea = createMockTextarea(500)
    const panel = createMockPanel(400) // max = 132
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
    )

    renderHook(() => useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef))

    triggerResize()
    expect(textarea.style.height).toBe('132px')

    // Panel grows
    panel.clientHeight = 600 // max = 198
    triggerResize()
    expect(textarea.style.height).toBe('198px')
  })

  it('attaches input event listener to textarea', () => {
    const textarea = createMockTextarea()
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      createMockPanel(),
    )

    renderHook(() => useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef))

    expect(textarea.addEventListener).toHaveBeenCalledWith('input', expect.any(Function))
  })

  it('removes event listener on unmount', () => {
    const textarea = createMockTextarea()
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      createMockPanel(),
    )

    const { unmount } = renderHook(() =>
      useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef),
    )

    unmount()

    expect(textarea.removeEventListener).toHaveBeenCalledWith('input', expect.any(Function))
  })

  it('handles null textarea gracefully', () => {
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      null,
      createMockPanel(),
    )

    const { result } = renderHook(() =>
      useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef),
    )

    expect(() => {
      act(() => {
        result.current.resizeTextarea()
      })
    }).not.toThrow()
  })

  it('handles null panel gracefully', () => {
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      createMockTextarea(),
      null,
    )

    // Should not throw during render
    expect(() => {
      renderHook(() =>
        useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef),
      )
    }).not.toThrow()
  })

  it('uses minimum max height of 120px', () => {
    const textarea = createMockTextarea(100)
    const panel = createMockPanel(100) // 100 * 0.33 = 33, but min is 120
    const { textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef } = createRefs(
      textarea,
      panel,
    )

    renderHook(() => useTextareaResize(textareaRef, panelRef, messagesRef, isAutoScrollEnabledRef))

    triggerResize()

    // Should use min height of 120, so 100 scrollHeight fits
    expect(textarea.style.height).toBe('100px')
  })
})
