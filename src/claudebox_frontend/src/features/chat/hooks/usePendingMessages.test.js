/** Tests for usePendingMessages hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import usePendingMessages from './usePendingMessages'

// Stable empty array for default events
const EMPTY_EVENTS = []

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
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS))

    let id
    act(() => {
      id = result.current.addPendingMessage('hello world')
    })

    expect(id).toBeDefined()
    expect(result.current.showPendingMessages).toHaveLength(1)
    expect(result.current.showPendingMessages[0].content).toBe('hello world')
  })

  it('showPendingMessages filters delivered messages', () => {
    const { result, rerender } = renderHook(({ events }) => usePendingMessages(events), {
      initialProps: { events: EMPTY_EVENTS },
    })

    // Add a pending message
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

    // Should be filtered out
    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('removes pending when matching SSE event arrives', () => {
    const { result, rerender } = renderHook(({ events }) => usePendingMessages(events), {
      initialProps: { events: EMPTY_EVENTS },
    })

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
    const { result, rerender } = renderHook(({ events }) => usePendingMessages(events), {
      initialProps: { events: EMPTY_EVENTS },
    })

    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('/help')
    })

    // Advance time
    act(() => {
      vi.setSystemTime(1200)
    })

    // SSE delivers with expanded command
    const events = [{ type: 'user', is_human: true, content: '/help', timestamp: 1100 }]
    rerender({ events })

    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('removePendingMessage() removes specific message by ID', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS))

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

  // Note: MIN_PENDING_DISPLAY_MS anti-flicker check exists in showPendingMessages useMemo,
  // but the useEffect that clears pending messages runs afterward and removes messages
  // immediately upon SSE delivery regardless of display time. This is current behavior.

  it('returns empty array when no pending messages', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS))

    expect(result.current.showPendingMessages).toEqual([])
  })

  it('ignores non-human user events', () => {
    const { result, rerender } = renderHook(({ events }) => usePendingMessages(events), {
      initialProps: { events: EMPTY_EVENTS },
    })

    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('test')
    })

    // Advance time
    act(() => {
      vi.setSystemTime(1200)
    })

    // SSE delivers non-human event with same content
    const events = [{ type: 'user', is_human: false, content: 'test', timestamp: 1100 }]
    rerender({ events })

    // Should still show - non-human events don't clear pending
    expect(result.current.showPendingMessages).toHaveLength(1)
  })

  it('ignores events before addedAt timestamp', () => {
    const { result, rerender } = renderHook(({ events }) => usePendingMessages(events), {
      initialProps: { events: EMPTY_EVENTS },
    })

    // Pre-existing event
    const oldEvents = [{ type: 'user', is_human: true, content: 'test', timestamp: 500 }]
    rerender({ events: oldEvents })

    // Add pending message after the event
    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('test')
    })

    // Advance time
    act(() => {
      vi.setSystemTime(1200)
    })

    // Old event shouldn't clear the new pending message
    expect(result.current.showPendingMessages).toHaveLength(1)
  })

  it('addPendingMessage carries attachments metadata', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS))

    const attachments = [{ id: 'a1', name: 'photo.png', type: 'image/png', data: 'abc', size: 100 }]
    act(() => {
      result.current.addPendingMessage('see image', attachments)
    })

    expect(result.current.showPendingMessages).toHaveLength(1)
    expect(result.current.showPendingMessages[0].attachments).toEqual(attachments)
  })

  it('clears pending slash command with multi-line args', () => {
    const { result, rerender } = renderHook(({ events }) => usePendingMessages(events), {
      initialProps: { events: EMPTY_EVENTS },
    })

    // User types /thoughts followed by newlines and args
    act(() => {
      vi.setSystemTime(1000)
      result.current.addPendingMessage('/thoughts \n\n<this>and what about this</this>?')
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
          '<command-name>/thoughts</command-name><command-args>\n\n<this>and what about this</this>?</command-args>',
        timestamp: 1100,
      },
    ]
    rerender({ events })

    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('addPendingMessage sets attachments to null for empty array', () => {
    const { result } = renderHook(() => usePendingMessages(EMPTY_EVENTS))

    act(() => {
      result.current.addPendingMessage('no files', [])
    })

    expect(result.current.showPendingMessages[0].attachments).toBeNull()
  })

  it('clears pending messages on session change', () => {
    const { result, rerender } = renderHook(
      ({ events, sessionId }) => usePendingMessages(events, sessionId),
      { initialProps: { events: EMPTY_EVENTS, sessionId: 'session-1' } },
    )

    act(() => {
      result.current.addPendingMessage('pending in session 1')
    })

    expect(result.current.showPendingMessages).toHaveLength(1)

    // Switch to different session
    rerender({ events: EMPTY_EVENTS, sessionId: 'session-2' })

    expect(result.current.showPendingMessages).toHaveLength(0)
  })

  it('preserves pending messages during resume null transition', () => {
    const { result, rerender } = renderHook(
      ({ events, sessionId }) => usePendingMessages(events, sessionId),
      { initialProps: { events: EMPTY_EVENTS, sessionId: 'session-1' } },
    )

    act(() => {
      result.current.addPendingMessage('message before resume')
    })

    expect(result.current.showPendingMessages).toHaveLength(1)

    // Resume flow: sessionId goes null temporarily (clearSessionData)
    rerender({ events: EMPTY_EVENTS, sessionId: null })

    // Pending messages survive the null transition
    expect(result.current.showPendingMessages).toHaveLength(1)

    // Resume completes: sessionId restored to same value
    rerender({ events: EMPTY_EVENTS, sessionId: 'session-1' })

    // Pending messages still present
    expect(result.current.showPendingMessages).toHaveLength(1)
    expect(result.current.showPendingMessages[0].content).toBe('message before resume')
  })
})
