/** Tests for InteractionContext. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractionProvider, useInteraction } from './InteractionContext'

vi.mock('../api/chat', () => ({
  sendMessage: vi.fn(),
}))

let mockEventsData = { events: [], isResponding: false }
vi.mock('./EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

let mockRouting = { activeSessionId: 'A' }
vi.mock('./SessionRoutingContext', () => ({
  useSessionRouting: () => mockRouting,
}))

describe('useInteraction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockEventsData = { events: [], isResponding: false }
    mockRouting = { activeSessionId: 'A' }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const wrapper = ({ children }) => <InteractionProvider>{children}</InteractionProvider>
  const renderInteraction = () => renderHook(() => useInteraction(), { wrapper })

  it('reads flags raised in one session as idle in another, and live again back in it', () => {
    const { result, rerender } = renderInteraction()
    act(() => {
      result.current.startSubmitting()
      result.current.submitSucceeded()
    })
    expect(result.current.isAwaitingResponse).toBe(true)

    mockRouting = { activeSessionId: 'B' }
    rerender()
    expect(result.current.isAwaitingResponse).toBe(false)
    expect(result.current.isSubmitting).toBe(false)

    mockRouting = { activeSessionId: 'A' }
    rerender()
    expect(result.current.isAwaitingResponse).toBe(true)
  })

  it('reads an interrupt started in one session as none in another', () => {
    const { result, rerender } = renderInteraction()
    act(() => {
      result.current.startInterrupt()
    })

    mockRouting = { activeSessionId: 'B' }
    rerender()

    expect(result.current.interruptStatus).toBe(null)
  })

  it('shows a hint for as long as a transient error, without touching the submit state', () => {
    const { result } = renderInteraction()
    act(() => {
      result.current.startSubmitting()
      result.current.showHint('Wait for the session to load')
    })

    expect(result.current.hintMessage).toBe('Wait for the session to load')
    expect(result.current.isSubmitting).toBe(true)

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(result.current.hintMessage).toBe(null)
  })

  it('startSubmitting() sets isSubmitting=true', () => {
    const { result } = renderInteraction()

    act(() => {
      result.current.startSubmitting()
    })

    expect(result.current.isSubmitting).toBe(true)
  })

  it('submitSucceeded() clears isSubmitting, sets isAwaitingResponse', () => {
    const { result } = renderInteraction()

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
    const { result } = renderInteraction()

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
    const { result } = renderInteraction()

    act(() => {
      result.current.startInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopping')
  })

  it('completeInterrupt() sets interruptStatus="stopped"', () => {
    const { result } = renderInteraction()

    act(() => {
      result.current.startInterrupt()
      result.current.completeInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopped')
  })

  it('setError() sets error message and clears transient states', () => {
    const { result } = renderInteraction()

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
    const { result } = renderInteraction()

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
    const { result, rerender } = renderInteraction()

    act(() => {
      result.current.startInterrupt()
      result.current.completeInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopped')

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
    const { result, rerender } = renderInteraction()

    act(() => {
      result.current.startInterrupt()
      result.current.completeInterrupt()
    })

    expect(result.current.interruptStatus).toBe('stopped')

    mockEventsData = {
      events: [{ type: 'assistant', timestamp: Date.now() }],
      isResponding: true,
    }
    rerender()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // No result event yet - stays 'stopped'.
    expect(result.current.interruptStatus).toBe('stopped')
  })

  describe('submitPrompt', () => {
    it('calls sendMessage and transitions through submitting states on success', async () => {
      const { sendMessage } = await import('../api/chat')
      sendMessage.mockResolvedValueOnce({})

      const { result } = renderInteraction()

      let outcome
      await act(async () => {
        outcome = await result.current.submitPrompt('hello world')
      })

      expect(outcome).toBe(true)
      expect(sendMessage).toHaveBeenCalledWith('hello world')
      expect(result.current.isSubmitting).toBe(false)
      expect(result.current.isAwaitingResponse).toBe(true)
    })

    it('sets error message on sendMessage failure', async () => {
      const { sendMessage } = await import('../api/chat')
      sendMessage.mockRejectedValueOnce(new Error('network error'))

      const { result } = renderInteraction()

      let outcome
      await act(async () => {
        outcome = await result.current.submitPrompt('hello world')
      })

      expect(outcome).toBe(false)
      expect(result.current.isSubmitting).toBe(false)
      expect(result.current.isAwaitingResponse).toBe(false)
      expect(result.current.errorMessage).toBe('Send failed')
    })

    it('ignores empty or whitespace-only prompts', async () => {
      const { sendMessage } = await import('../api/chat')
      sendMessage.mockClear()

      const { result } = renderInteraction()

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

      const { result } = renderInteraction()

      let submitPromise
      act(() => {
        submitPromise = result.current.submitPrompt('test')
      })

      expect(result.current.isSubmitting).toBe(true)

      await act(async () => {
        resolvePromise({})
        await submitPromise
      })

      expect(result.current.isSubmitting).toBe(false)
    })
  })

  describe('isAwaitingResponse clearing', () => {
    const renderAwaitingResponse = submittedAt => {
      vi.setSystemTime(new Date(submittedAt))
      const view = renderInteraction()
      act(() => {
        view.result.current.startSubmitting()
        view.result.current.submitSucceeded()
      })
      expect(view.result.current.isAwaitingResponse).toBe(true)

      return view
    }

    it('clears isAwaitingResponse when assistant event arrives after submission timestamp', () => {
      const { result, rerender } = renderAwaitingResponse(1000)

      mockEventsData = {
        events: [{ type: 'assistant', content: 'response', timestamp: 2000 }],
        isResponding: true,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(false)
    })

    it('clears isAwaitingResponse when result event arrives after submission timestamp', () => {
      const { result, rerender } = renderAwaitingResponse(1000)

      mockEventsData = {
        events: [{ type: 'result', success: true, timestamp: 2000 }],
        isResponding: false,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(false)
    })

    it('keeps isAwaitingResponse when event timestamp is before submission', () => {
      const { result, rerender } = renderAwaitingResponse(5000)

      mockEventsData = {
        events: [{ type: 'assistant', content: 'old', timestamp: 1000 }],
        isResponding: true,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(true)
    })

    it('clears isAwaitingResponse when SSE arrives before POST resolves (fast backend)', () => {
      vi.setSystemTime(new Date(1000))

      const { result, rerender } = renderInteraction()

      // startSubmitting captures timestamp at T=1000
      act(() => {
        result.current.startSubmitting()
      })

      // SSE result arrives at T=1500 (before POST resolves)
      mockEventsData = {
        events: [{ type: 'result', success: true, timestamp: 1500 }],
        isResponding: false,
      }

      // POST resolves - submitSucceeded sets isAwaitingResponse=true
      vi.setSystemTime(new Date(2000))
      act(() => {
        result.current.submitSucceeded()
      })
      rerender()

      // Should clear because event.timestamp (1500) > awaitingResponseSince (1000)
      expect(result.current.isAwaitingResponse).toBe(false)
    })

    it('keeps isAwaitingResponse for non-assistant/non-result events', () => {
      const { result, rerender } = renderAwaitingResponse(1000)

      mockEventsData = {
        events: [{ type: 'user', content: 'echo', timestamp: 2000 }],
        isResponding: false,
      }
      rerender()

      expect(result.current.isAwaitingResponse).toBe(true)
    })
  })

  it('initial state has all flags false/null', () => {
    const { result } = renderInteraction()

    expect(result.current.isSubmitting).toBe(false)
    expect(result.current.isAwaitingResponse).toBe(false)
    expect(result.current.interruptStatus).toBeNull()
    expect(result.current.errorMessage).toBeNull()
  })
})
