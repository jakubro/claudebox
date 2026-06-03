/** Tests for EventsContext. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/apiClient', () => ({
  getContainerId: () => 'test-container',
  getWorkspaceId: () => 'test-workspace',
}))

import { EventsProvider, useEvents } from './EventsContext'

// Mock EventSource class
class MockEventSource {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0 // CONNECTING
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    MockEventSource.instances.push(this)
  }

  close() {
    this.readyState = 2 // CLOSED
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1 // OPEN
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateError() {
    this.readyState = 2
    this.onerror?.(new Event('error'))
  }
}

describe('EventsContext', () => {
  let originalEventSource

  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.instances = []
    originalEventSource = global.EventSource
    global.EventSource = MockEventSource
  })

  afterEach(() => {
    vi.useRealTimers()
    global.EventSource = originalEventSource
  })

  const wrapper = ({ children }) => <EventsProvider>{children}</EventsProvider>
  const getLatestEventSource = () => MockEventSource.instances[MockEventSource.instances.length - 1]

  /**
   * Send events through EventSource and flush the batch timer.
   */
  const sendAndFlush = (es, ...events) => {
    act(() => {
      es.simulateOpen()
      for (const event of events) {
        es.simulateMessage(event)
      }
    })
    act(() => {
      vi.advanceTimersByTime(50)
    })
  }

  describe('connection status', () => {
    it('transitions to connecting on mount', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      expect(result.current.connectionStatus).toBe('connecting')
    })

    it('transitions to connected on open', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      expect(result.current.connectionStatus).toBe('connected')
      expect(result.current.isConnected).toBe(true)
    })

    it('transitions to reconnecting on SSE error', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      act(() => {
        es.simulateError()
      })

      expect(result.current.connectionStatus).toBe('reconnecting')
      expect(result.current.connectionError).toBe('Connection lost')
      expect(result.current.isConnected).toBe(false)
    })

    it('auto-reconnects after error', () => {
      renderHook(() => useEvents(), { wrapper })
      const initialEs = getLatestEventSource()

      act(() => {
        initialEs.simulateOpen()
        initialEs.simulateError()
      })

      expect(MockEventSource.instances).toHaveLength(1)

      // Wait for RECONNECT_BASE_DELAY (1000ms)
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(MockEventSource.instances).toHaveLength(2)
    })

    it('clears error on successful reconnect', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateError()
      })

      expect(result.current.connectionError).toBe('Connection lost')

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      const newEs = getLatestEventSource()
      act(() => {
        newEs.simulateOpen()
      })

      expect(result.current.connectionError).toBeNull()
      expect(result.current.connectionStatus).toBe('connected')
    })
  })

  describe('event batching', () => {
    it('batches events for 50ms before state update', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      // Send 3 events rapidly
      act(() => {
        es.simulateMessage({ type: 'user', content: 'first' })
        es.simulateMessage({ type: 'assistant', content: 'second' })
        es.simulateMessage({ type: 'assistant', content: 'third' })
      })

      // Events not yet in state (batching)
      expect(result.current.events).toHaveLength(0)

      // After batch interval
      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.events).toHaveLength(3)
    })

    it('timestamps events on arrival', () => {
      vi.setSystemTime(new Date(1000))
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'user', content: 'hello' })
      })

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.events[0].timestamp).toBe(1000)
    })

    it('flushes partial batch at interval', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'user', content: 'single' })
      })

      expect(result.current.events).toHaveLength(0)

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.events).toHaveLength(1)
    })

    it('handles multiple batch intervals', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'user', content: 'batch1' })
      })

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.events).toHaveLength(1)

      act(() => {
        es.simulateMessage({ type: 'assistant', content: 'batch2' })
      })

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.events).toHaveLength(2)
    })
  })

  describe('isResponding', () => {
    it('false when no events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      expect(result.current.isResponding).toBe(false)
    })

    it('false with only user events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.isResponding).toBe(false)
    })

    it('true when assistant without result', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'assistant', content: 'thinking' })

      expect(result.current.isResponding).toBe(true)
    })

    it('false when assistant followed by result', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'assistant', content: 'done' }, { type: 'result', success: true })

      expect(result.current.isResponding).toBe(false)
    })

    it('true when new assistant after result', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(
        es,
        { type: 'assistant', content: 'first turn' },
        { type: 'result', success: true },
        { type: 'user', content: 'next question' },
        { type: 'assistant', content: 'second turn' },
      )

      expect(result.current.isResponding).toBe(true)
    })

    it('false when multiple results after last assistant', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(
        es,
        { type: 'assistant', content: 'response' },
        { type: 'result', success: true },
        { type: 'result', success: true }, // Multiple results
      )

      expect(result.current.isResponding).toBe(false)
    })
  })

  describe('reconnectSSE', () => {
    it('clears events array', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.events).toHaveLength(1)

      act(() => {
        result.current.reconnectSSE()
      })

      expect(result.current.events).toHaveLength(0)
    })

    it('creates new EventSource', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const initialEs = getLatestEventSource()

      act(() => {
        initialEs.simulateOpen()
      })

      const countBefore = MockEventSource.instances.length

      act(() => {
        result.current.reconnectSSE()
      })

      expect(MockEventSource.instances.length).toBe(countBefore + 1)
    })

    it('closes previous EventSource', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      expect(es.readyState).toBe(1) // OPEN

      act(() => {
        result.current.reconnectSSE()
      })

      expect(es.readyState).toBe(2) // CLOSED
    })

    it('cancels pending reconnect timeout', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateError() // Triggers reconnect timeout
      })

      const countAfterError = MockEventSource.instances.length

      act(() => {
        result.current.reconnectSSE()
      })

      // Manual reconnect
      const countAfterReconnect = MockEventSource.instances.length
      expect(countAfterReconnect).toBe(countAfterError + 1)

      // Advance past the auto-reconnect delay
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Should NOT have created another connection (timeout was cancelled)
      expect(MockEventSource.instances.length).toBe(countAfterReconnect)
    })

    it('clears pending batch', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'user', content: 'will be cleared' })
      })

      // Don't wait for batch to flush
      expect(result.current.events).toHaveLength(0)

      act(() => {
        result.current.reconnectSSE()
      })

      // Now wait for batch interval
      act(() => {
        vi.advanceTimersByTime(50)
      })

      // Batch should have been cleared
      expect(result.current.events).toHaveLength(0)
    })
  })

  describe('disconnectSSE', () => {
    it('clears events array', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.events).toHaveLength(1)

      act(() => {
        result.current.disconnectSSE()
      })

      expect(result.current.events).toHaveLength(0)
    })

    it('closes EventSource without creating new one', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      const countBefore = MockEventSource.instances.length

      act(() => {
        result.current.disconnectSSE()
      })

      expect(es.readyState).toBe(2) // CLOSED
      expect(MockEventSource.instances.length).toBe(countBefore) // No new connection
    })

    it('transitions to disconnected status', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      expect(result.current.connectionStatus).toBe('connected')

      act(() => {
        result.current.disconnectSSE()
      })

      expect(result.current.connectionStatus).toBe('disconnected')
      expect(result.current.isConnected).toBe(false)
    })

    it('does not auto-reconnect after disconnect', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      act(() => {
        result.current.disconnectSSE()
      })

      const countAfter = MockEventSource.instances.length

      // Advance well past any reconnect delay
      act(() => {
        vi.advanceTimersByTime(10000)
      })

      expect(MockEventSource.instances.length).toBe(countAfter)
    })
  })

  describe('cleanup', () => {
    it('closes EventSource on unmount', () => {
      const { unmount } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
      })

      expect(es.readyState).toBe(1)

      unmount()

      expect(es.readyState).toBe(2)
    })

    it('clears reconnect timeout on unmount', () => {
      const { unmount } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateError()
      })

      const countAfterError = MockEventSource.instances.length

      unmount()

      // Advance past reconnect delay
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Should NOT have reconnected
      expect(MockEventSource.instances.length).toBe(countAfterError)
    })
  })

  describe('isCompacting', () => {
    it('flips true on compact_start, false on compact_boundary', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'system', subtype: 'compact_start' })
      expect(result.current.isCompacting).toBe(true)

      sendAndFlush(es, { type: 'system', subtype: 'compact_boundary' })
      expect(result.current.isCompacting).toBe(false)
    })

    it('cleared by a human user message (boundary lost recovery)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'system', subtype: 'compact_start' })
      expect(result.current.isCompacting).toBe(true)

      // Boundary never arrives — user sends new message; isCompacting must reset
      sendAndFlush(es, { type: 'user', is_human: true, content: 'next prompt' })
      expect(result.current.isCompacting).toBe(false)
    })

    it('NOT cleared by non-human user events (form responses, tool results)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'system', subtype: 'compact_start' })
      expect(result.current.isCompacting).toBe(true)

      // Form-response user events (is_human=false) are not new turn boundaries
      sendAndFlush(es, { type: 'user', is_human: false, content: '<response:Form>' })
      expect(result.current.isCompacting).toBe(true)
    })

    it('cleared on REPLAY_ENDED (orphan compact_start in persisted log)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 1 })
        es.simulateMessage({ type: 'system', subtype: 'compact_start' })
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      expect(result.current.isCompacting).toBe(false)
    })

    it('cleared by CLEAR_EVENTS (session switch / reconnect)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'system', subtype: 'compact_start' })
      expect(result.current.isCompacting).toBe(true)

      act(() => {
        result.current.reconnectSSE()
      })

      expect(result.current.isCompacting).toBe(false)
    })
  })

  describe('isResuming', () => {
    it('false initially', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      expect(result.current.isResuming).toBe(false)
    })

    it('true after startResume()', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.startResume()
      })

      expect(result.current.isResuming).toBe(true)
    })

    it('false after clearResume()', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.startResume()
      })

      expect(result.current.isResuming).toBe(true)

      act(() => {
        result.current.clearResume()
      })

      expect(result.current.isResuming).toBe(false)
    })

    it('preserved across CLEAR_EVENTS (reconnectSSE)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.startResume()
      })

      expect(result.current.isResuming).toBe(true)

      act(() => {
        result.current.reconnectSSE()
      })

      expect(result.current.isResuming).toBe(true)
    })

    it('cleared on REPLAY_ENDED', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        result.current.startResume()
      })

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 1 })
      })

      act(() => {
        es.simulateMessage({ type: 'user', content: 'msg1' })
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      expect(result.current.isResuming).toBe(false)
      expect(result.current.isReplaying).toBe(false)
    })
  })

  describe('isCreating', () => {
    it('preserved across CLEAR_EVENTS (reconnectSSE)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.startCreating()
      })

      expect(result.current.isCreating).toBe(true)

      act(() => {
        result.current.reconnectSSE()
      })

      // isCreating preserved — ChatPanel effect clears it when SSE connects
      expect(result.current.isCreating).toBe(true)
    })

    it('cleared by clearCreating', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.startCreating()
      })

      expect(result.current.isCreating).toBe(true)

      act(() => {
        result.current.clearCreating()
      })

      expect(result.current.isCreating).toBe(false)
    })
  })

  describe('replay boundary events', () => {
    it('sets isReplaying true on replay_started', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 10 })
      })

      expect(result.current.isReplaying).toBe(true)
    })

    it('sets replayTotal from replay_started count', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 42 })
      })

      expect(result.current.replayTotal).toBe(42)
    })

    it('defaults replayTotal to 0 when count missing', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started' })
      })

      expect(result.current.replayTotal).toBe(0)
    })

    it('tracks replayProgress as pending batch length during replay', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 5 })
      })

      act(() => {
        es.simulateMessage({ type: 'user', content: 'msg1' })
        es.simulateMessage({ type: 'assistant', content: 'msg2' })
      })

      expect(result.current.replayProgress).toBe(2)
    })

    it('sets isReplaying false on replay_ended', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 3 })
      })

      act(() => {
        es.simulateMessage({ type: 'user', content: 'msg1' })
        es.simulateMessage({ type: 'assistant', content: 'msg2' })
        es.simulateMessage({ type: 'result', success: true })
      })

      act(() => {
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      expect(result.current.isReplaying).toBe(false)
    })

    it('flushes all accumulated events on replay_ended', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 3 })
      })

      act(() => {
        es.simulateMessage({ type: 'user', content: 'msg1' })
        es.simulateMessage({ type: 'assistant', content: 'msg2' })
        es.simulateMessage({ type: 'result', success: true })
      })

      // Events should not be in state.events yet (still in pending batch)
      expect(result.current.events).toHaveLength(0)

      act(() => {
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      // All events flushed at once
      expect(result.current.events).toHaveLength(3)
      expect(result.current.replayProgress).toBe(0)
    })

    it('does not flush batch on timer during replay', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 2 })
      })

      act(() => {
        es.simulateMessage({ type: 'user', content: 'msg1' })
      })

      // Advance past normal batch interval
      act(() => {
        vi.advanceTimersByTime(50)
      })

      // Events should still be pending (not flushed by timer)
      expect(result.current.events).toHaveLength(0)
      expect(result.current.replayProgress).toBe(1)
    })

    // TaskCreate / TaskUpdate populates the same todosBySubagent store as
    // TodoWrite via appendTaskDiffs.
    it('TaskCreate populates todosBySubagent', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        // TaskCreate tool_use carrying the subject + description.
        es.simulateMessage({
          type: 'assistant',
          subtype: 'tool_use',
          content: 'TaskCreate',
          tool_use_id: 'tu-1',
          tool_input: {
            subject: 'Implement appendTaskDiffs',
            description: 'Mirror appendTodoDiffs shape',
            activeForm: 'Implementing appendTaskDiffs',
          },
        })
        // Matching tool_result delivering the taskId.
        es.simulateMessage({
          type: 'user',
          subtype: 'tool_result',
          tool_use_id: 'tu-1',
          tool_use_result: { task: { id: '1', subject: 'Implement appendTaskDiffs' } },
        })
      })

      // Flush the 50 ms timer so derived state commits.
      act(() => {
        vi.advanceTimersByTime(50)
      })

      const mainTodos = result.current.todosBySubagent.get('main') || []
      expect(mainTodos).toHaveLength(1)
      expect(mainTodos[0].content).toBe('Implement appendTaskDiffs')
      expect(mainTodos[0].subtitle).toBe('Mirror appendTodoDiffs shape')
    })

    // Streaming events buffer in a provider-level ref between flushes; only
    // flag changes dispatch per event. state.pendingBatch stays empty during
    // streaming; events commit only on the 50 ms flush.
    // (input:smooth-during-response is anchored via an E2E spec; this unit
    // test only proves the underlying batching mechanism.)
    it('streaming events buffer outside reducer state between flushes', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        // Five streaming events arrive faster than the flush interval
        for (let i = 0; i < 5; i++) {
          es.simulateMessage({ type: 'assistant', content: `chunk-${i}` })
        }
      })

      // Pre-flush: reducer's pendingBatch (exposed as replayProgress) is
      // untouched; events live in the provider's ref buffer
      expect(result.current.replayProgress).toBe(0)
      expect(result.current.events).toHaveLength(0)

      // The flush timer drains the buffer into state in one dispatch
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(result.current.events).toHaveLength(5)
      expect(result.current.replayProgress).toBe(0)
    })

    it('replay_started event itself is not added to events array', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 1 })
      })

      act(() => {
        es.simulateMessage({ type: 'user', content: 'msg1' })
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      // Only the user message should be in events, not the system boundary events
      expect(result.current.events).toHaveLength(1)
      expect(result.current.events[0].type).toBe('user')
    })
  })

  describe('todoDiffs derived value', () => {
    it('returns empty map when no TodoWrite events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.todoDiffs).toBeInstanceOf(Map)
      expect(result.current.todoDiffs.size).toBe(0)
    })

    it('computes diffs for TodoWrite tool_use events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_1',
        tool_input: {
          todos: [{ content: 'Task A', status: 'in_progress' }],
        },
      })

      expect(result.current.todoDiffs.size).toBe(1)
      expect(result.current.todoDiffs.has('tu_1')).toBe(true)
    })

    it('updates diffs when new events arrive', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_1',
        tool_input: {
          todos: [{ content: 'Task A', status: 'in_progress' }],
        },
      })

      expect(result.current.todoDiffs.size).toBe(1)

      // Second TodoWrite event
      act(() => {
        es.simulateMessage({
          type: 'assistant',
          subtype: 'tool_use',
          content: 'TodoWrite',
          tool_use_id: 'tu_2',
          tool_input: {
            todos: [
              { content: 'Task A', status: 'completed' },
              { content: 'Task B', status: 'in_progress' },
            ],
          },
        })
      })

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.todoDiffs.size).toBe(2)
      expect(result.current.todoDiffs.has('tu_2')).toBe(true)
    })
  })

  describe('error handling', () => {
    it('ignores invalid JSON messages', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        // Send invalid JSON directly
        es.onmessage?.({ data: 'not valid json{{{' })
      })

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.events).toHaveLength(0)
    })
  })

  describe('isResponding with pending events', () => {
    it('isResponding true when assistant in pending batch (before flush)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'assistant', content: 'thinking' })
      })

      // Before batch flushes - isResponding should already be true
      expect(result.current.isResponding).toBe(true)
    })

    it('isResponding false when result in pending batch (before flush)', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'assistant', content: 'done' })
        es.simulateMessage({ type: 'result', success: true })
      })

      // Before batch flushes - isResponding should already be false
      expect(result.current.isResponding).toBe(false)
    })

    it('isResponding updates immediately on new assistant event', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      // First turn complete
      sendAndFlush(es, { type: 'assistant', content: 'first' }, { type: 'result', success: true })

      expect(result.current.isResponding).toBe(false)

      // New assistant event arrives (pending, not flushed)
      act(() => {
        es.simulateMessage({ type: 'user', content: 'next' })
        es.simulateMessage({ type: 'assistant', content: 'second' })
      })

      // Should be true IMMEDIATELY, not after 50ms
      expect(result.current.isResponding).toBe(true)
    })
  })

  describe('derived state', () => {
    it('visibleEvents filters out system init, hook_response, and result events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(
        es,
        { type: 'system', subtype: 'init', content: 'init' },
        { type: 'system', subtype: 'hook_response', content: 'hook' },
        { type: 'user', is_human: true, content: 'Hello', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Hi', turn_id: 't1' },
        { type: 'result', subtype: 'success', turn_id: 't1' },
      )

      expect(result.current.events).toHaveLength(5)
      expect(result.current.visibleEvents).toHaveLength(2)
      expect(result.current.visibleEvents[0].content).toBe('Hello')
      expect(result.current.visibleEvents[1].content).toBe('Hi')
    })

    it('turns are correctly grouped from visible events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(
        es,
        { type: 'user', is_human: true, content: 'Question', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Answer', turn_id: 't1' },
      )

      expect(result.current.turns).toHaveLength(1)
      expect(result.current.turns[0].userMessage).toBe('Question')
      expect(result.current.turns[0].events).toHaveLength(1)
      expect(result.current.turns[0].events[0].content).toBe('Answer')
    })

    it('turnResults maps result events to turn_ids', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(
        es,
        { type: 'user', is_human: true, content: 'Ask', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Reply', turn_id: 't1' },
        { type: 'result', subtype: 'success', turn_id: 't1' },
      )

      expect(result.current.turnResults).toEqual({ t1: 'success' })
    })

    it('taskNotifications indexes notification events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(es, {
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'agent-1', status: 'completed', summary: 'Done' },
      })

      expect(result.current.taskNotifications.size).toBe(1)
      expect(result.current.taskNotifications.get('agent-1').status).toBe('completed')
    })

    it('todoDiffs computes diffs for TodoWrite events', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(
        es,
        {
          subtype: 'tool_use',
          content: 'TodoWrite',
          tool_use_id: 'tu_1',
          tool_input: { todos: [{ content: 'Task A', status: 'pending' }] },
        },
        {
          subtype: 'tool_use',
          content: 'TodoWrite',
          tool_use_id: 'tu_2',
          tool_input: {
            todos: [
              { content: 'Task A', status: 'completed' },
              { content: 'Task B', status: 'pending' },
            ],
          },
        },
      )

      expect(result.current.todoDiffs.size).toBe(2)
      const diff2 = result.current.todoDiffs.get('tu_2')
      expect(diff2.completed).toHaveLength(1)
      expect(diff2.completed[0].content).toBe('Task A')
      expect(diff2.added).toHaveLength(1)
      expect(diff2.added[0].content).toBe('Task B')
    })

    it('CLEAR_EVENTS resets all derived state', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      sendAndFlush(
        es,
        { type: 'user', is_human: true, content: 'Hello', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Hi', turn_id: 't1' },
        { type: 'result', subtype: 'success', turn_id: 't1' },
      )

      expect(result.current.turns).toHaveLength(1)
      expect(result.current.events).toHaveLength(3)

      // reconnectSSE dispatches CLEAR_EVENTS
      act(() => {
        result.current.reconnectSSE()
      })

      expect(result.current.events).toHaveLength(0)
      expect(result.current.visibleEvents).toHaveLength(0)
      expect(result.current.turns).toHaveLength(0)
      expect(result.current.turnResults).toEqual({})
      expect(result.current.taskNotifications.size).toBe(0)
      expect(result.current.todoDiffs.size).toBe(0)
    })

    it('second FLUSH_BATCH preserves first batch and appends incrementally', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      // First batch
      sendAndFlush(
        es,
        { type: 'user', is_human: true, content: 'First', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Reply 1', turn_id: 't1' },
      )

      expect(result.current.turns).toHaveLength(1)
      expect(result.current.visibleEvents).toHaveLength(2)

      // Second batch (no re-open needed, connection already established)
      act(() => {
        es.simulateMessage({ type: 'user', is_human: true, content: 'Second', turn_id: 't2' })
        es.simulateMessage({
          type: 'assistant',
          subtype: 'text',
          content: 'Reply 2',
          turn_id: 't2',
        })
      })
      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.turns).toHaveLength(2)
      expect(result.current.turns[0].userMessage).toBe('First')
      expect(result.current.turns[1].userMessage).toBe('Second')
      expect(result.current.events).toHaveLength(4)
      expect(result.current.visibleEvents).toHaveLength(4)
    })
  })

  describe('consecutive error recovery', () => {
    it('reconnects after recovery then re-error', () => {
      renderHook(() => useEvents(), { wrapper })
      const es1 = getLatestEventSource()

      // First error
      act(() => {
        es1.simulateOpen()
        es1.simulateError()
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Reconnected
      const es2 = getLatestEventSource()
      expect(es2).not.toBe(es1)

      // Recover, then error again
      act(() => {
        es2.simulateOpen()
        es2.simulateError()
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Should reconnect again (third connection)
      expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(3)
    })

    it('resets error state on successful reconnect after multiple errors', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es1 = getLatestEventSource()

      act(() => {
        es1.simulateOpen()
        es1.simulateError()
      })

      expect(result.current.connectionStatus).toBe('reconnecting')

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      const es2 = getLatestEventSource()
      act(() => {
        es2.simulateOpen()
      })

      expect(result.current.connectionStatus).toBe('connected')
      expect(result.current.connectionError).toBeNull()
    })
  })
})
