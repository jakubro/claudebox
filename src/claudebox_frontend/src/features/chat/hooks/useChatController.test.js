/** Tests for useChatController hook. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useChatController from './useChatController'

// --- Mutable mock state ---

let mockSessionId = 'session-1'
let mockResultCount = 0
let mockInteractionData = {}

// --- Mock context hooks ---

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: mockSessionId }),
  useSessionActions: () => ({ reloadSession: vi.fn() }),
}))

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => ({ resultCount: mockResultCount }),
}))

vi.mock('../../../context/InteractionContext', () => ({
  useInteraction: () => ({
    interruptStatus: null,
    startSubmitting: vi.fn(),
    submitSucceeded: vi.fn(),
    submitFailed: vi.fn(),
    setError: vi.fn(),
    errorMessage: null,
    ...mockInteractionData,
  }),
}))

// --- Mock API to prevent real network calls from useSendMessage ---

vi.mock('../../../api/chat', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    sendMessage: vi.fn().mockResolvedValue({}),
  }
})

describe('useChatController session change scroll reset', () => {
  let rafCallbacks = []

  beforeEach(() => {
    rafCallbacks = []
    mockSessionId = 'session-1'
    mockResultCount = 0
    mockInteractionData = {}

    vi.stubGlobal('requestAnimationFrame', cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })

    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * Flush pending requestAnimationFrame callbacks.
   */
  function flushRAF() {
    const callbacks = rafCallbacks.splice(0)
    for (const cb of callbacks) {
      cb()
    }
  }

  /**
   * Create default props for useChatController.
   */
  function createProps(overrides = {}) {
    return {
      events: [],
      contextRefs: {
        chatScrollPositionRef: { current: 0 },
        chatAutoScrollEnabledRef: { current: true },
      },
      ...overrides,
    }
  }

  it('resets autoscroll to enabled on session change', () => {
    const props = createProps()
    // Simulate autoscroll disabled from previous session
    props.contextRefs.chatAutoScrollEnabledRef.current = false

    const { rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: props },
    })

    // Switch session via context mock
    mockSessionId = 'session-2'
    const newProps = createProps()
    newProps.contextRefs = props.contextRefs
    rerender({ p: newProps })
    flushRAF()

    expect(props.contextRefs.chatAutoScrollEnabledRef.current).toBe(true)
  })

  it('re-enables autoscroll ref on session change', () => {
    const props = createProps()
    props.contextRefs.chatAutoScrollEnabledRef.current = false

    const { result, rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: props },
    })

    // Disable local ref too
    result.current.scroll.isAutoScrollEnabledRef.current = false

    // Switch session via context mock
    mockSessionId = 'session-2'
    const newProps = createProps()
    newProps.contextRefs = props.contextRefs
    rerender({ p: newProps })
    flushRAF()

    expect(result.current.scroll.isAutoScrollEnabledRef.current).toBe(true)
  })

  it('does not reset autoscroll when session stays the same', () => {
    const props = createProps()

    const { result, rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: props },
    })

    // Disable autoscroll (user scrolled up)
    result.current.scroll.isAutoScrollEnabledRef.current = false
    props.contextRefs.chatAutoScrollEnabledRef.current = false

    // Re-render with same sessionId but new events
    const sameSessionProps = createProps({ events: [{ type: 'assistant', id: '1' }] })
    sameSessionProps.contextRefs = props.contextRefs
    rerender({ p: sameSessionProps })
    flushRAF()

    // Autoscroll should stay disabled
    expect(result.current.scroll.isAutoScrollEnabledRef.current).toBe(false)
  })

  it('scrolls to bottom via events effect after session change', () => {
    const props = createProps()

    const { rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: props },
    })

    // Switch session with events (simulating replay completion) via context mock
    mockSessionId = 'session-2'
    const newProps = createProps({
      events: [{ type: 'assistant', id: '1' }],
    })
    newProps.contextRefs = props.contextRefs
    rerender({ p: newProps })
    flushRAF()

    // Autoscroll should be enabled, so onEventsChange will scroll
    expect(props.contextRefs.chatAutoScrollEnabledRef.current).toBe(true)
  })
})
