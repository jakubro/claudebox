/** Tests for usePendingMessages hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOUNCE, SWITCH } from '../../../test-utils/sessionSequences'
import usePendingMessages from './usePendingMessages'

// Stable empty array for default events
const EMPTY_EVENTS = []

function renderPending() {
  return renderHook(({ events }) => usePendingMessages(events, 'A', true), {
    initialProps: { events: EMPTY_EVENTS },
  })
}

describe('usePendingMessages', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `test-uuid-${Math.random().toString(36).slice(2)}`),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('addPendingMessage() adds to pending list with ID', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS, 'A', true))

    let id
    act(() => {
      id = result.current.addPendingMessage('hello world')
    })

    expect(id).toBeDefined()
    expect(result.current.showPendingMessages).toHaveLength(1)
    expect(result.current.showPendingMessages[0].content).toBe('hello world')
  })

  it('showPendingMessages filters delivered messages', () => {
    const { result, rerender } = renderPending()

    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('test message')
    })

    // Advance past minimum display time
    act(() => {
      vi.setSystemTime(1200)
    })

    expect(result.current.showPendingMessages).toHaveLength(1)

    // Simulate SSE delivering the message
    const events = [{ type: 'user', is_human: true, content: 'test message', timestamp: 1100 }]
    rerender({ events })

    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('removes pending when matching SSE event arrives', () => {
    const { result, rerender } = renderPending()

    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('hello')
    })

    // Advance time past minimum display
    act(() => {
      vi.setSystemTime(1200)
    })

    // SSE delivers matching message
    const events = [{ type: 'user', is_human: true, content: 'hello', timestamp: 1100 }]
    rerender({ events })

    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('handles slash command normalization for matching', () => {
    const { result, rerender } = renderPending()

    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('/help')
    })

    act(() => {
      vi.setSystemTime(1200)
    })

    // SSE delivers with expanded command
    const events = [{ type: 'user', is_human: true, content: '/help', timestamp: 1100 }]
    rerender({ events })

    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('removePendingMessage() removes specific message by ID', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS, 'A', true))

    let id1
    act(() => {
      id1 = result.current.addPendingMessage('message 1')
      result.current.addPendingMessage('message 2')
    })

    expect(result.current.showPendingMessages).toHaveLength(2)

    act(() => {
      result.current.removePendingMessage(id1)
    })

    expect(result.current.showPendingMessages).toHaveLength(1)
    expect(result.current.showPendingMessages[0].content).toBe('message 2')
  })

  // MIN_PENDING_DISPLAY_MS anti-flicker applies only in showPendingMessages; the clearing useEffect
  // removes messages immediately on SSE delivery regardless of display time.

  it('returns empty array when no pending messages', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS, 'A', true))

    expect(result.current.showPendingMessages).toEqual([])
  })

  it('ignores non-human user events', () => {
    const { result, rerender } = renderPending()

    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('test')
    })

    act(() => {
      vi.setSystemTime(1200)
    })

    // SSE delivers non-human event with same content
    const events = [{ type: 'user', is_human: false, content: 'test', timestamp: 1100 }]
    rerender({ events })

    // Non-human events don't clear pending
    expect(result.current.showPendingMessages).toHaveLength(1)
  })

  it('ignores events before addedAt timestamp', () => {
    const { result, rerender } = renderPending()

    // Pre-existing event
    const oldEvents = [{ type: 'user', is_human: true, content: 'test', timestamp: 500 }]
    rerender({ events: oldEvents })

    // Add pending message after the event
    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('test')
    })

    act(() => {
      vi.setSystemTime(1200)
    })

    // Old event shouldn't clear the new pending message
    expect(result.current.showPendingMessages).toHaveLength(1)
  })

  it('addPendingMessage carries attachments metadata', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS, 'A', true))

    const attachments = [{ id: 'a1', name: 'photo.png', type: 'image/png', data: 'abc', size: 100 }]
    act(() => {
      result.current.addPendingMessage('see image', attachments)
    })

    expect(result.current.showPendingMessages).toHaveLength(1)
    expect(result.current.showPendingMessages[0].attachments).toEqual(attachments)
  })

  it('clears pending slash command with multi-line args', () => {
    const { result, rerender } = renderPending()

    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('/greet \n\n<this>and what about this</this>?')
    })

    act(() => {
      vi.setSystemTime(1200)
    })

    // SSE delivers with XML-wrapped command (parseSlashCommand normalizes args)
    const events = [
      {
        type: 'user',
        is_human: true,
        content:
          '<command-name>/greet</command-name><command-args>\n\n<this>and what about this</this>?</command-args>',
        timestamp: 1100,
      },
    ]
    rerender({ events })

    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('addPendingMessage sets attachments to null for empty array', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS, 'A', true))

    act(() => {
      result.current.addPendingMessage('no files', [])
    })

    expect(result.current.showPendingMessages[0].attachments).toBeNull()
  })

  function renderOwned(initial) {
    return renderHook(
      ({ events, owner, canReconcile }) => usePendingMessages(events, owner, canReconcile),
      { initialProps: initial },
    )
  }

  it('hides a message sent from A once B is routed, and shows it again back in A', () => {
    const [a, , b] = SWITCH
    const { result, rerender } = renderOwned({ events: EMPTY_EVENTS, owner: a, canReconcile: true })
    act(() => {
      result.current.addPendingMessage('typed in A')
    })

    rerender({ events: EMPTY_EVENTS, owner: b, canReconcile: false })
    expect(result.current.showPendingMessages).toEqual([])
    rerender({ events: EMPTY_EVENTS, owner: b, canReconcile: true })
    expect(result.current.showPendingMessages).toEqual([])

    rerender({ events: EMPTY_EVENTS, owner: a, canReconcile: true })
    expect(result.current.showPendingMessages.map(pm => pm.content)).toEqual(['typed in A'])
  })

  it("keeps A's message when B's history holds the same text", () => {
    const [a, , b] = SWITCH
    const { result, rerender } = renderOwned({ events: EMPTY_EVENTS, owner: a, canReconcile: true })
    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('yes')
    })
    act(() => {
      vi.setSystemTime(5000)
    })

    const bHistory = [{ type: 'user', is_human: true, content: 'yes', timestamp: 4000 }]
    rerender({ events: bHistory, owner: b, canReconcile: true })
    rerender({ events: EMPTY_EVENTS, owner: a, canReconcile: true })

    expect(result.current.showPendingMessages.map(pm => pm.content)).toEqual(['yes'])
  })

  it('keeps a message through the resume bounce of its own session', () => {
    const [a] = BOUNCE
    const { result, rerender } = renderOwned({ events: EMPTY_EVENTS, owner: a, canReconcile: true })
    act(() => {
      result.current.addPendingMessage('message before resume')
    })

    // The route stays on A while the attached session empties and returns.
    rerender({ events: EMPTY_EVENTS, owner: a, canReconcile: false })
    expect(result.current.showPendingMessages).toHaveLength(1)
    rerender({ events: EMPTY_EVENTS, owner: a, canReconcile: true })

    expect(result.current.showPendingMessages.map(pm => pm.content)).toEqual([
      'message before resume',
    ])
  })
})
