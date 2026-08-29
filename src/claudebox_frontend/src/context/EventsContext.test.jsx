/** Tests for EventsContext. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/apiClient', () => ({
  getContainerId: () => 'test-container',
  getWorkspaceId: () => 'test-workspace',
}))

import { REPLAY_DRAIN_SLICE_SIZE } from '../config/thresholds'
import { EventsProvider, useEvents } from './EventsContext'

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

  // The drain yields through a MessagePort no timer mock advances - post a message and wait for
  // it back. Node runs the whole queue in one turn, so the e2e suite asserts slice pacing.
  const flushReplayDrain = async () => {
    await act(async () => {
      await new Promise(resolve => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(null)
      })
    })
  }

  /** Sends events through EventSource and flushes the batch timer. */
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

      act(() => {
        es.simulateMessage({ type: 'user', content: 'first' })
        es.simulateMessage({ type: 'assistant', content: 'second' })
        es.simulateMessage({ type: 'assistant', content: 'third' })
      })

      expect(result.current.events).toHaveLength(0)

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
        { type: 'result', success: true },
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
        es.simulateError()
      })

      const countAfterError = MockEventSource.instances.length

      act(() => {
        result.current.reconnectSSE()
      })

      const countAfterReconnect = MockEventSource.instances.length
      expect(countAfterReconnect).toBe(countAfterError + 1)

      act(() => {
        vi.advanceTimersByTime(1000)
      })

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

      act(() => {
        vi.advanceTimersByTime(50)
      })

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

      act(() => {
        vi.advanceTimersByTime(1000)
      })

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

      // Boundary never arrives - user sends new message; isCompacting must reset
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

    it('cleared on REPLAY_ENDED', async () => {
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
      await flushReplayDrain()

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

      // isCreating preserved - ChatPanel effect clears it when SSE connects
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

  describe('markJustCreatedSession / consumeJustCreatedSession', () => {
    it('consuming a matching id returns true and clears the marker', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.markJustCreatedSession('s1')
      })

      let consumed
      act(() => {
        consumed = result.current.consumeJustCreatedSession('s1')
      })
      expect(consumed).toBe(true)

      // Second consume for the same id fails - the marker is one-shot.
      let consumedAgain
      act(() => {
        consumedAgain = result.current.consumeJustCreatedSession('s1')
      })
      expect(consumedAgain).toBe(false)
    })

    it('consuming a non-matching id returns false and leaves the marker in place', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.markJustCreatedSession('s1')
      })

      let consumed
      act(() => {
        consumed = result.current.consumeJustCreatedSession('s2')
      })
      expect(consumed).toBe(false)

      // s1's marker survived the mismatched check.
      let consumedS1
      act(() => {
        consumedS1 = result.current.consumeJustCreatedSession('s1')
      })
      expect(consumedS1).toBe(true)
    })

    it('consuming with nothing marked returns false', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      let consumed
      act(() => {
        consumed = result.current.consumeJustCreatedSession('s1')
      })
      expect(consumed).toBe(false)
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

    it('advances replayProgress as slices drain, not as events arrive', async () => {
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

      // Buffered but not yet materialized - progress reports what is on screen.
      expect(result.current.replayProgress).toBe(0)

      await flushReplayDrain()

      expect(result.current.replayProgress).toBe(2)
    })

    it('sets isReplaying false on replay_ended', async () => {
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
      await flushReplayDrain()

      expect(result.current.isReplaying).toBe(false)
    })

    it('materializes replayed events progressively, before replay_ended arrives', async () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 3 })
      })

      act(() => {
        es.simulateMessage({ type: 'user', is_human: true, content: 'msg1' })
        es.simulateMessage({ type: 'assistant', content: 'msg2' })
        es.simulateMessage({ type: 'result', success: true })
      })

      await flushReplayDrain()

      // On screen before the server has closed the transcript - the point of draining in slices.
      expect(result.current.events).toHaveLength(3)
      expect(result.current.turns).toHaveLength(1)
      expect(result.current.isReplaying).toBe(true)

      act(() => {
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })
      await flushReplayDrain()

      expect(result.current.events).toHaveLength(3)
      expect(result.current.isReplaying).toBe(false)
    })

    it('keeps isReplaying true until the buffer finishes draining', async () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()
      const total = REPLAY_DRAIN_SLICE_SIZE + 10

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: total })
      })

      act(() => {
        for (let i = 0; i < total; i++) {
          es.simulateMessage({ type: 'assistant', content: `chunk-${i}` })
        }
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      // The server's replay_ended does not clear the overlay on its own - the queue must drain.
      expect(result.current.events).toHaveLength(0)
      expect(result.current.isReplaying).toBe(true)

      await flushReplayDrain()

      expect(result.current.events).toHaveLength(total)
      expect(result.current.isReplaying).toBe(false)
    })

    it('keeps a live event arriving mid-drain behind the replayed history', async () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()
      const total = REPLAY_DRAIN_SLICE_SIZE + 10

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: total })
      })

      act(() => {
        for (let i = 0; i < total; i++) {
          es.simulateMessage({ type: 'assistant', content: `history-${i}` })
        }
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      // The transcript is closed but its queue has not drained; a live event arriving now must not
      // overtake the history still waiting in it.
      act(() => {
        es.simulateMessage({ type: 'assistant', content: 'live-after-replay' })
      })

      await flushReplayDrain()

      const contents = result.current.events.map(e => e.content)
      expect(contents).toHaveLength(total + 1)
      expect(contents[contents.length - 1]).toBe('live-after-replay')
      expect(contents.indexOf(`history-${total - 1}`)).toBeLessThan(contents.length - 1)
    })

    it('cancels an in-flight drain when the stream reconnects', async () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 3 })
        es.simulateMessage({ type: 'user', content: 'stale-1' })
        es.simulateMessage({ type: 'assistant', content: 'stale-2' })
      })

      act(() => {
        result.current.reconnectSSE()
      })

      // A pending slice must not commit the previous session's events into the freshly cleared chat.
      await flushReplayDrain()

      expect(result.current.events).toHaveLength(0)
      expect(result.current.turns).toHaveLength(0)
      expect(result.current.isReplaying).toBe(false)
    })

    // TaskCreate/TaskUpdate populates the same todosBySubagent store as TodoWrite via appendTaskDiffs.
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

    // Streaming events buffer in a provider ref between flushes; only flag changes dispatch per
    // event, so events commit only when the batch timer flushes. Smooth-during-response is
    // covered by an E2E test; this unit test only proves the batching mechanism.
    it('streaming events buffer outside reducer state between flushes', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const es = getLatestEventSource()

      act(() => {
        es.simulateOpen()
        for (let i = 0; i < 5; i++) {
          es.simulateMessage({ type: 'assistant', content: `chunk-${i}` })
        }
      })

      // Pre-flush: reducer's pendingBatch (exposed as replayProgress) is untouched; events live
      // in the provider's ref buffer.
      expect(result.current.replayProgress).toBe(0)
      expect(result.current.events).toHaveLength(0)

      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(result.current.events).toHaveLength(5)
      expect(result.current.replayProgress).toBe(0)
    })

    it('replay_started event itself is not added to events array', async () => {
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
      await flushReplayDrain()

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

      sendAndFlush(
        es,
        { type: 'user', is_human: true, content: 'First', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Reply 1', turn_id: 't1' },
      )

      expect(result.current.turns).toHaveLength(1)
      expect(result.current.visibleEvents).toHaveLength(2)

      // Connection is already established, so no simulateOpen() call is needed here.
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

      act(() => {
        es1.simulateOpen()
        es1.simulateError()
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      const es2 = getLatestEventSource()
      expect(es2).not.toBe(es1)

      act(() => {
        es2.simulateOpen()
        es2.simulateError()
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

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

  describe('subscribeSession', () => {
    it('opens a second stream that never reaches the primary reducer', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const primary = getLatestEventSource()
      act(() => {
        primary.simulateOpen()
      })

      const onSessionMessage = vi.fn()
      act(() => {
        result.current.subscribeSession('session-b', 'container-b', onSessionMessage)
      })

      const secondary = getLatestEventSource()
      expect(secondary).not.toBe(primary)
      expect(secondary.url).toBe(
        '/api/workspaces/test-workspace/containers/container-b/api/stream?session_id=session-b',
      )

      act(() => {
        secondary.simulateOpen()
        secondary.simulateMessage({ type: 'user', subtype: 'message', content: 'from b' })
      })

      expect(onSessionMessage).toHaveBeenCalledTimes(1)
      expect(result.current.events).toEqual([])
      expect(result.current.turns).toEqual([])
    })

    it('the active session keeps streaming while a second one is open', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const primary = getLatestEventSource()

      act(() => {
        result.current.subscribeSession('session-b', 'container-b', vi.fn())
      })
      const secondary = getLatestEventSource()

      sendAndFlush(primary, {
        id: 'e1',
        type: 'user',
        subtype: 'message',
        content: 'hi',
        is_human: true,
        turn_id: 't1',
      })

      expect(result.current.turns.length).toBe(1)

      act(() => {
        secondary.simulateMessage({ type: 'user', subtype: 'message', content: 'from b' })
      })

      // The second session's message does not join the active session's transcript.
      expect(result.current.turns.length).toBe(1)
    })

    it("unsubscribeSession closes only that session's stream", () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      act(() => {
        result.current.subscribeSession('session-b', 'container-b', vi.fn())
      })
      const secondary = getLatestEventSource()

      act(() => {
        result.current.unsubscribeSession('session-b')
      })

      expect(secondary.readyState).toBe(2) // CLOSED
    })

    it('does nothing when no container id is given for the session', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })
      const before = MockEventSource.instances.length

      act(() => {
        result.current.subscribeSession('session-b', null, vi.fn())
      })

      expect(MockEventSource.instances.length).toBe(before)
    })

    it('composes session_id and replay=false on the same query string', () => {
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.subscribeSession('session-b', 'container-b', vi.fn(), { replay: false })
      })

      expect(getLatestEventSource().url).toBe(
        '/api/workspaces/test-workspace/containers/container-b/api/stream?session_id=session-b&replay=false',
      )
    })

    it('surfaces onError once the keyed stream exhausts its reconnect attempts, and only once', () => {
      const onError = vi.fn()
      const { result } = renderHook(() => useEvents(), { wrapper })

      act(() => {
        result.current.subscribeSession('session-b', 'container-b', vi.fn(), { onError })
      })

      act(() => {
        getLatestEventSource().simulateError()
      })

      // RECONNECT_MAX_ATTEMPTS reconnects at RECONNECT_BASE_DELAY, doubling each time - erroring
      // the freshly-opened instance after each delay drives the manager to exhaustion.
      for (const delay of [1000, 2000, 4000]) {
        act(() => {
          vi.advanceTimersByTime(delay)
        })
        act(() => {
          getLatestEventSource().simulateError()
        })
      }

      expect(onError).toHaveBeenCalledTimes(1)
    })
  })
})
