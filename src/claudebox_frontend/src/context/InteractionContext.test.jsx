/** Tests for InteractionContext. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractionProvider, useInteraction } from './InteractionContext'

// Mock dependencies
vi.mock('../api/chat', () => ({
  sendMessage: vi.fn(),
}))

let mockEventsData = { events: [], isResponding: false }
vi.mock('./EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

describe('useInteraction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockEventsData = { events: [], isResponding: false }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const wrapper = ({ children }) => <InteractionProvider>{children}</InteractionProvider>

  it('startSubmitting() sets isSubmitting=true', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.startSubmitting()
    })

    expect(result.current.isSubmitting).toBe(true)
  })

  it('submitSucceeded() clears isSubmitting, sets isAwaitingResponse', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.startSubmitting()
    })

    expect(result.current.isSubmitting).toBe(true)

    act(() => {
      result.current.submitSucceeded()
    })

    expect(result.current.isSubmitting).toBe(false)
    expect(result.current.isAwaitingResponse).toBe(true)
  })

  it('submitFailed() clears isSubmitting', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.startSubmitting()
    })

    expect(result.current.isSubmitting).toBe(true)

    act(() => {
      result.current.submitFailed()
    })

    expect(result.current.isSubmitting).toBe(false)
    expect(result.current.isAwaitingResponse).toBe(false)
  })

  it('startInterrupt() sets interruptStatus="stopping"', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.startInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopping')
  })

  it('completeInterrupt() sets interruptStatus="stopped"', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.startInterrupt()
      result.current.completeInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopped')
  })

  it('setError() sets error message and clears transient states', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.startSubmitting()
      result.current.startInterrupt()
      result.current.setError('Something went wrong')
    })

    expect(result.current.errorMessage).toBe('Something went wrong')
    expect(result.current.isSubmitting).toBe(false)
    expect(result.current.interruptStatus).toBeNull()
  })

  it('auto-clears error message after 4 seconds', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.setError('Temporary error')
    })

    expect(result.current.errorMessage).toBe('Temporary error')

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(result.current.errorMessage).toBeNull()
  })

  it('clears "stopped" status after result event arrives', () => {
    mockEventsData = { events: [], isResponding: true }
    const { result, rerender } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.completeInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopped')

    // Simulate result event arriving (turn complete)
    mockEventsData = {
      events: [{ type: 'result', timestamp: Date.now() }],
      isResponding: false,
    }
    rerender()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(result.current.interruptStatus).toBeNull()
  })

  it('keeps "stopped" status when responses arrive without result event', () => {
    mockEventsData = { events: [], isResponding: false }
    const { result, rerender } = renderHook(() => useInteraction(), { wrapper })

    act(() => {
      result.current.completeInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopped')

    // Simulate assistant events arriving without result event
    mockEventsData = {
      events: [{ type: 'assistant', timestamp: Date.now() }],
      isResponding: true,
    }
    rerender()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Should still be stopped (no result event yet)
    expect(result.current.interruptStatus).toBe('stopped')
  })

  describe('submitPrompt', () => {
    it('calls sendMessage and transitions through submitting states on success', async () => {
      const { sendMessage } = await import('../api/chat')
      sendMessage.mockResolvedValueOnce({})

      const { result } = renderHook(() => useInteraction(), { wrapper })

      await act(async () => {
        await result.current.submitPrompt('hello world')
      })

      expect(sendMessage).toHaveBeenCalledWith('hello world')
      expect(result.current.isSubmitting).toBe(false)
      expect(result.current.isAwaitingResponse).toBe(true)
    })

    it('sets error message on sendMessage failure', async () => {
      const { sendMessage } = await import('../api/chat')
      sendMessage.mockRejectedValueOnce(new Error('network error'))

      const { result } = renderHook(() => useInteraction(), { wrapper })

      await act(async () => {
        await result.current.submitPrompt('hello world')
      })

      expect(result.current.isSubmitting).toBe(false)
      expect(result.current.isAwaitingResponse).toBe(false)
      expect(result.current.errorMessage).toBe('Send failed')
    })

    it('ignores empty or whitespace-only prompts', async () => {
      const { sendMessage } = await import('../api/chat')
      sendMessage.mockClear()

      const { result } = renderHook(() => useInteraction(), { wrapper })

      await act(async () => {
        await result.current.submitPrompt('')
      })

      await act(async () => {
        await result.current.submitPrompt('   ')
      })

      await act(async () => {
        await result.current.submitPrompt(null)
      })

      expect(sendMessage).not.toHaveBeenCalled()
      expect(result.current.isSubmitting).toBe(false)
    })

    it('sets isSubmitting true during the request', async () => {
      const { sendMessage } = await import('../api/chat')
      let resolvePromise
      sendMessage.mockReturnValueOnce(
        new Promise(r => {
          resolvePromise = r
        }),
      )

      const { result } = renderHook(() => useInteraction(), { wrapper })

      let submitPromise
      act(() => {
        submitPromise = result.current.submitPrompt('test')
      })

      // While request is in flight
      expect(result.current.isSubmitting).toBe(true)

      await act(async () => {
        resolvePromise({})
        await submitPromise
      })

      expect(result.current.isSubmitting).toBe(false)
    })
  })

  describe('isAwaitingResponse clearing', () => {
    it('clears isAwaitingResponse when assistant event arrives after submission timestamp', () => {
      vi.setSystemTime(new Date(1000))

      const { result, rerender } = renderHook(() => useInteraction(), { wrapper })

      act(() => {
        result.current.startSubmitting()
        result.current.submitSucceeded()
      })

      expect(result.current.isAwaitingResponse).toBe(true)

      // Simulate an assistant event arriving with timestamp after submission
      mockEventsData = {
        events: [{ type: 'assistant', content: 'response', timestamp: 2000 }],
        isResponding: true,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(false)
    })

    it('clears isAwaitingResponse when result event arrives after submission timestamp', () => {
      vi.setSystemTime(new Date(1000))

      const { result, rerender } = renderHook(() => useInteraction(), { wrapper })

      act(() => {
        result.current.startSubmitting()
        result.current.submitSucceeded()
      })

      expect(result.current.isAwaitingResponse).toBe(true)

      mockEventsData = {
        events: [{ type: 'result', success: true, timestamp: 2000 }],
        isResponding: false,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(false)
    })

    it('keeps isAwaitingResponse when event timestamp is before submission', () => {
      vi.setSystemTime(new Date(5000))

      const { result, rerender } = renderHook(() => useInteraction(), { wrapper })

      act(() => {
        result.current.startSubmitting()
        result.current.submitSucceeded()
      })

      expect(result.current.isAwaitingResponse).toBe(true)

      // Event with timestamp before submission
      mockEventsData = {
        events: [{ type: 'assistant', content: 'old', timestamp: 1000 }],
        isResponding: true,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(true)
    })

    it('clears isAwaitingResponse when SSE arrives before POST resolves (fast backend)', () => {
      vi.setSystemTime(new Date(1000))

      const { result, rerender } = renderHook(() => useInteraction(), { wrapper })

      // startSubmitting captures timestamp at T=1000
      act(() => {
        result.current.startSubmitting()
      })

      // SSE result arrives at T=1500 (before POST resolves)
      mockEventsData = {
        events: [{ type: 'result', success: true, timestamp: 1500 }],
        isResponding: false,
      }

      // POST resolves — submitSucceeded sets isAwaitingResponse=true
      vi.setSystemTime(new Date(2000))
      act(() => {
        result.current.submitSucceeded()
      })
      rerender()

      // Should clear because event.timestamp (1500) > awaitingResponseSince (1000)
      expect(result.current.isAwaitingResponse).toBe(false)
    })

    it('keeps isAwaitingResponse for non-assistant/non-result events', () => {
      vi.setSystemTime(new Date(1000))

      const { result, rerender } = renderHook(() => useInteraction(), { wrapper })

      act(() => {
        result.current.startSubmitting()
        result.current.submitSucceeded()
      })

      mockEventsData = {
        events: [{ type: 'user', content: 'echo', timestamp: 2000 }],
        isResponding: false,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(true)
    })
  })

  it('initial state has all flags false/null', () => {
    const { result } = renderHook(() => useInteraction(), { wrapper })

    expect(result.current.isSubmitting).toBe(false)
    expect(result.current.isAwaitingResponse).toBe(false)
    expect(result.current.interruptStatus).toBeNull()
    expect(result.current.errorMessage).toBeNull()
  })
})
