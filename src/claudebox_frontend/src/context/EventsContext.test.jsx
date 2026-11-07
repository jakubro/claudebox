/** Tests for EventsContext. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/apiClient', async importOriginal => ({
  ...(await importOriginal()),
  getAddressedSessionId: () => 'test-session',
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
  const renderEvents = () => {
    const { result } = renderHook(() => useEvents(), { wrapper })

    return { result, es: getLatestEventSource() }
  }

  const renderReplaying = count => {
    const view = renderEvents()
    act(() => {
      view.es.simulateOpen()
      view.es.simulateMessage({ type: 'system', subtype: 'replay_started', count })
    })

    return view
  }

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
    it('opens the stream of the addressed session, not the container default', () => {
      renderHook(() => useEvents(), { wrapper })

      expect(getLatestEventSource().url).toBe(
        '/api/workspaces/test-workspace/containers/test-container/api/stream?session_id=test-session',
      )
    })

    it('transitions to connecting on mount', () => {
      const { result } = renderEvents()
      expect(result.current.connectionStatus).toBe('connecting')
    })

    it('transitions to connected on open', () => {
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
      })

      expect(result.current.connectionStatus).toBe('connected')
      expect(result.current.isConnected).toBe(true)
    })

    it('transitions to reconnecting on SSE error', () => {
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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

  describe('turn end', () => {
    const launchThenEnd = [
      { type: 'user', subtype: 'text', is_human: true, content: 'go', turn_id: 't1' },
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'tu1',
        tool_input: { command: 'sleep 90', description: 'Wait' },
      },
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'tu1',
        tool_use_result: { backgroundTaskId: 'b1' },
      },
      { type: 'result', subtype: 'success', turn_id: 't1' },
    ]

    it('lands the turn and its background work together, without waiting for the batch timer', () => {
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
        for (const event of launchThenEnd) {
          es.simulateMessage(event)
        }
      })

      expect(result.current.isResponding).toBe(false)
      expect(result.current.events).toHaveLength(4)
      expect(result.current.runningBackgroundWork.map(w => w.name)).toEqual(['Wait'])
    })

    it('reports a pick-up as pending once a tracked task finishes after the turn ended', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, ...launchThenEnd, {
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'b1', status: 'completed' },
      })

      expect(result.current.runningBackgroundWork).toEqual([])
      expect(result.current.awaitingPickup).toBe(true)
    })

    it('clears the pending pick-up once the agent responds', () => {
      const { result, es } = renderEvents()

      sendAndFlush(
        es,
        ...launchThenEnd,
        {
          type: 'system',
          subtype: 'task_notification',
          message_data: { task_id: 'b1', status: 'completed' },
        },
        { type: 'assistant', subtype: 'text', content: 'It finished.' },
      )

      expect(result.current.awaitingPickup).toBe(false)
    })

    it('clears the pending pick-up on a result with no reply, as after a stop and resume', () => {
      const { result, es } = renderEvents()

      sendAndFlush(
        es,
        ...launchThenEnd,
        {
          type: 'system',
          subtype: 'task_notification',
          message_data: { task_id: 'b1', status: 'killed' },
        },
        { type: 'result', subtype: 'success', turn_id: 't1' },
      )

      expect(result.current.awaitingPickup).toBe(false)
    })

    it('keeps the empty running list one identity across flushes', () => {
      const { result, es } = renderEvents()
      sendAndFlush(es, { type: 'assistant', subtype: 'text', content: 'a' })
      const first = result.current.runningBackgroundWork

      sendAndFlush(es, { type: 'assistant', subtype: 'text', content: 'b' })

      expect(result.current.runningBackgroundWork).toBe(first)
    })
  })

  describe('isResponding', () => {
    it('false when no events', () => {
      const { result } = renderEvents()

      expect(result.current.isResponding).toBe(false)
    })

    it('false with only user events', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.isResponding).toBe(false)
    })

    it('true when assistant without result', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, { type: 'assistant', content: 'thinking' })

      expect(result.current.isResponding).toBe(true)
    })

    it('false when assistant followed by result', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, { type: 'assistant', content: 'done' }, { type: 'result', success: true })

      expect(result.current.isResponding).toBe(false)
    })

    it('true when new assistant after result', () => {
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

      sendAndFlush(
        es,
        { type: 'assistant', content: 'response' },
        { type: 'result', success: true },
        { type: 'result', success: true },
      )

      expect(result.current.isResponding).toBe(false)
    })

    it('false when a reported runtime failure arrives instead of a result', () => {
      const { result, es } = renderEvents()

      sendAndFlush(
        es,
        { type: 'assistant', content: 'thinking' },
        { type: 'system', subtype: 'error', content: 'runtime crashed' },
      )

      expect(result.current.isResponding).toBe(false)
    })

    it('stays false while a background subagent works after the turn ended', () => {
      const { result, es } = renderEvents()

      sendAndFlush(
        es,
        { type: 'assistant', content: 'Launched.' },
        { type: 'result', subtype: 'success' },
        { type: 'assistant', subtype: 'tool_use', content: 'Bash', parent_tool_use_id: 'task1' },
      )

      expect(result.current.isResponding).toBe(false)
    })
  })

  describe('reconnectSSE', () => {
    it('leaves events on screen until the new connection replays', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.events).toHaveLength(1)

      act(() => {
        result.current.reconnectSSE()
      })

      expect(result.current.events).toHaveLength(1)
    })

    it('creates new EventSource', () => {
      const { result } = renderEvents()
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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.events).toHaveLength(1)

      act(() => {
        result.current.disconnectSSE()
      })

      expect(result.current.events).toHaveLength(0)
    })

    it('closes EventSource without creating new one', () => {
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
    const renderCompacting = () => {
      const view = renderEvents()
      sendAndFlush(view.es, { type: 'system', subtype: 'compact_start' })
      expect(view.result.current.isCompacting).toBe(true)

      return view
    }

    it('flips true on compact_start, false on compact_boundary', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, { type: 'system', subtype: 'compact_start' })
      expect(result.current.isCompacting).toBe(true)

      sendAndFlush(es, { type: 'system', subtype: 'compact_boundary' })
      expect(result.current.isCompacting).toBe(false)
    })

    it('cleared by a human user message (boundary lost recovery)', () => {
      const { result, es } = renderCompacting()

      // Boundary never arrives - user sends new message; isCompacting must reset
      sendAndFlush(es, { type: 'user', is_human: true, content: 'next prompt' })
      expect(result.current.isCompacting).toBe(false)
    })

    it('NOT cleared by non-human user events (form responses, tool results)', () => {
      const { result, es } = renderCompacting()

      // Form-response user events (is_human=false) are not new turn boundaries
      sendAndFlush(es, { type: 'user', is_human: false, content: '<response:Form>' })
      expect(result.current.isCompacting).toBe(true)
    })

    it('cleared on REPLAY_ENDED (orphan compact_start in persisted log)', () => {
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 1 })
        es.simulateMessage({ type: 'system', subtype: 'compact_start' })
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })

      expect(result.current.isCompacting).toBe(false)
    })

    it('cleared by CLEAR_EVENTS (session switch / reconnect)', () => {
      const { result } = renderCompacting()

      act(() => {
        result.current.reconnectSSE()
      })

      expect(result.current.isCompacting).toBe(false)
    })
  })

  describe('isResuming', () => {
    it('false initially', () => {
      const { result } = renderEvents()
      expect(result.current.isResuming).toBe(false)
    })

    it('true after startResume()', () => {
      const { result } = renderEvents()

      act(() => {
        result.current.startResume()
      })

      expect(result.current.isResuming).toBe(true)
    })

    it('false after clearResume()', () => {
      const { result } = renderEvents()

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
      const { result } = renderEvents()

      act(() => {
        result.current.startResume()
      })

      expect(result.current.isResuming).toBe(true)

      act(() => {
        result.current.reconnectSSE()
      })

      expect(result.current.isResuming).toBe(true)
    })

    it('kept through a REPLAY_ENDED while the open request is pending', async () => {
      const { result, es } = renderEvents()

      act(() => {
        result.current.startResume()
      })

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 0 })
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })
      await flushReplayDrain()

      expect(result.current.isResuming).toBe(true)
      expect(result.current.isResumeRequestPending).toBe(true)
    })

    it('cleared on REPLAY_ENDED once the open request has settled', async () => {
      const { result, es } = renderEvents()

      act(() => {
        const token = result.current.startResume()
        result.current.settleResumeRequest(token)
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
      const { result } = renderEvents()

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

    it('ignores clearCreating while the create request is pending', () => {
      const { result } = renderEvents()

      act(() => {
        result.current.startCreating()
      })
      act(() => {
        result.current.clearCreating()
      })

      expect(result.current.isCreating).toBe(true)
      expect(result.current.isCreateRequestPending).toBe(true)
    })

    it('cleared by clearCreating once the create request has settled', () => {
      const { result } = renderEvents()

      act(() => {
        const seq = result.current.startCreating()
        result.current.settleCreateRequest(seq, 'sess-c')
      })
      expect(result.current.createdSessionId).toBe('sess-c')

      act(() => {
        result.current.clearCreating()
      })

      expect(result.current.isCreating).toBe(false)
    })

    it('cleared by failCreating, recording the failure', () => {
      const { result } = renderEvents()
      let seq

      act(() => {
        seq = result.current.startCreating('A')
      })
      act(() => {
        result.current.failCreating(seq)
      })

      expect(result.current.isCreating).toBe(false)
      expect(result.current.getCreation().bySeq[seq]).toEqual({
        status: 'failed',
        sessionId: null,
        fromRoute: 'A',
      })
    })

    it("records a creation's opening messages until each part is placed", () => {
      const { result } = renderEvents()
      let seq

      act(() => {
        seq = result.current.startCreating('A', ['alpha', 'bravo'])
      })
      const atStart = result.current.getCreation().bySeq[seq]
      act(() => {
        result.current.placeOpening(seq, 'carried')
        result.current.settleCreateRequest(seq, 'sess-c', {
          undeliveredMessages: ['alpha', 'bravo'],
          bundleMessages: ['delta'],
        })
      })
      const atAnswer = result.current.getCreation().bySeq[seq]
      act(() => {
        result.current.placeOpening(seq, 'answer')
      })

      expect(atStart).toEqual({
        status: 'pending',
        sessionId: null,
        fromRoute: 'A',
        carried: ['alpha', 'bravo'],
      })
      expect(atAnswer).toEqual({
        status: 'created',
        sessionId: 'sess-c',
        fromRoute: 'A',
        answer: { blocked: true, bundle: ['delta'] },
      })
      expect(result.current.getCreation().bySeq[seq]).toEqual({
        status: 'created',
        sessionId: 'sess-c',
        fromRoute: 'A',
      })
    })

    it('reads the creation record synchronously, before the next render', () => {
      const { result } = renderEvents()

      act(() => {
        const seq = result.current.startCreating()
        expect(result.current.getCreation().bySeq[seq].status).toBe('pending')
        expect(result.current.getPendingRequests().create).toBe(seq)
        result.current.settleCreateRequest(seq, 'sess-c')
        expect(result.current.getCreation().bySeq[seq].sessionId).toBe('sess-c')
        expect(result.current.getPendingRequests().create).toBe(null)
      })
    })

    it('marks the creation routed when its just-created session is consumed', () => {
      const { result } = renderEvents()
      let seq

      act(() => {
        seq = result.current.startCreating()
        result.current.settleCreateRequest(seq, 'sess-c')
        result.current.markJustCreatedSession('sess-c')
      })
      act(() => {
        expect(result.current.consumeJustCreatedSession('sess-c')).toBe(true)
      })

      expect(result.current.getCreation().bySeq[seq].status).toBe('routed')
      expect(result.current.createdSessionId).toBe('sess-c')
    })
  })

  describe('markJustCreatedSession / consumeJustCreatedSession', () => {
    it('consuming a matching id returns true and clears the marker', () => {
      const { result } = renderEvents()

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
      const { result } = renderEvents()

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
      const { result } = renderEvents()

      let consumed
      act(() => {
        consumed = result.current.consumeJustCreatedSession('s1')
      })
      expect(consumed).toBe(false)
    })
  })

  describe('replay boundary events', () => {
    it('sets isReplaying true on replay_started', () => {
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 10 })
      })

      expect(result.current.isReplaying).toBe(true)
    })

    it('sets replayTotal from replay_started count', () => {
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 42 })
      })

      expect(result.current.replayTotal).toBe(42)
    })

    it('defaults replayTotal to 0 when count missing', () => {
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started' })
      })

      expect(result.current.replayTotal).toBe(0)
    })

    it('advances replayProgress as slices drain, not as events arrive', async () => {
      const { result, es } = renderReplaying(5)

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
      const { result, es } = renderReplaying(3)

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
      const { result, es } = renderReplaying(3)

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
      const total = REPLAY_DRAIN_SLICE_SIZE + 10
      const { result, es } = renderReplaying(total)

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
      const total = REPLAY_DRAIN_SLICE_SIZE + 10
      const { result, es } = renderReplaying(total)

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderReplaying(1)

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

  describe('a restored connection replays without repeating', () => {
    const replayTurn = async es => {
      act(() => {
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 2 })
        es.simulateMessage({ type: 'user', is_human: true, content: 'Question', turn_id: 't1' })
        es.simulateMessage({ type: 'assistant', subtype: 'text', content: 'Answer', turn_id: 't1' })
      })
      await flushReplayDrain()
      act(() => {
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })
      await flushReplayDrain()
    }

    // The manager reopens on its own after a drop - no reconnectSSE() call, no dispatch of any
    // kind reaches the context.
    const dropAndReopen = es => {
      act(() => {
        es.simulateError()
        vi.advanceTimersByTime(1000) // RECONNECT_BASE_DELAY
      })
      return getLatestEventSource()
    }

    it('a drop and restore reads the conversation once, not twice', async () => {
      const { result } = renderEvents()
      let es = getLatestEventSource()
      act(() => es.simulateOpen())
      await replayTurn(es)

      expect(result.current.events).toHaveLength(2)
      expect(result.current.turns).toHaveLength(1)

      es = dropAndReopen(es)
      act(() => es.simulateOpen())
      await replayTurn(es)

      expect(result.current.events).toHaveLength(2)
      expect(result.current.turns).toHaveLength(1)
    })

    it('a second drop does not add a third copy', async () => {
      const { result } = renderEvents()
      let es = getLatestEventSource()
      act(() => es.simulateOpen())
      await replayTurn(es)

      for (let i = 0; i < 2; i++) {
        es = dropAndReopen(es)
        act(() => es.simulateOpen())
        await replayTurn(es)
      }

      expect(result.current.events).toHaveLength(2)
      expect(result.current.turns).toHaveLength(1)
    })

    it('a replay carrying no events still empties a transcript that held some', async () => {
      const { result } = renderEvents()
      let es = getLatestEventSource()
      act(() => es.simulateOpen())
      await replayTurn(es)
      expect(result.current.events).toHaveLength(2)

      es = dropAndReopen(es)
      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'system', subtype: 'replay_started', count: 0 })
        es.simulateMessage({ type: 'system', subtype: 'replay_ended' })
      })
      await flushReplayDrain()

      expect(result.current.events).toHaveLength(0)
      expect(result.current.turns).toHaveLength(0)
    })

    it('a session switch never shows an empty transcript between the two conversations', async () => {
      const { result, es } = renderEvents()
      act(() => es.simulateOpen())
      await replayTurn(es)
      expect(result.current.events).toHaveLength(2)

      // Mirrors SessionRoutingEffect's resume: reconnectSSE(), then the new session's own replay.
      act(() => result.current.reconnectSSE())
      expect(result.current.events).toHaveLength(2)

      const nextEs = getLatestEventSource()
      act(() => nextEs.simulateOpen())
      act(() => {
        nextEs.simulateMessage({ type: 'system', subtype: 'replay_started', count: 1 })
        nextEs.simulateMessage({
          type: 'user',
          is_human: true,
          content: 'Other session',
          turn_id: 't2',
        })
      })
      await flushReplayDrain()
      act(() => nextEs.simulateMessage({ type: 'system', subtype: 'replay_ended' }))
      await flushReplayDrain()

      expect(result.current.events).toHaveLength(1)
      expect(result.current.events[0].content).toBe('Other session')
    })
  })

  describe('todoDiffs derived value', () => {
    it('returns empty map when no TodoWrite events', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, { type: 'user', content: 'hello' })

      expect(result.current.todoDiffs).toBeInstanceOf(Map)
      expect(result.current.todoDiffs.size).toBe(0)
    })

    it('computes diffs for TodoWrite tool_use events', () => {
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'assistant', content: 'thinking' })
      })

      // Before batch flushes - isResponding should already be true
      expect(result.current.isResponding).toBe(true)
    })

    it('isResponding false when result in pending batch (before flush)', () => {
      const { result, es } = renderEvents()

      act(() => {
        es.simulateOpen()
        es.simulateMessage({ type: 'assistant', content: 'done' })
        es.simulateMessage({ type: 'result', success: true })
      })

      // Before batch flushes - isResponding should already be false
      expect(result.current.isResponding).toBe(false)
    })

    it('isResponding updates immediately on new assistant event', () => {
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

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
      const { result, es } = renderEvents()

      sendAndFlush(
        es,
        { type: 'user', is_human: true, content: 'Ask', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Reply', turn_id: 't1' },
        { type: 'result', subtype: 'success', turn_id: 't1' },
      )

      expect(result.current.turnResults).toEqual({ t1: 'success' })
    })

    it('taskNotifications indexes notification events', () => {
      const { result, es } = renderEvents()

      sendAndFlush(es, {
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'agent-1', status: 'completed', summary: 'Done' },
      })

      expect(result.current.taskNotifications.size).toBe(1)
      expect(result.current.taskNotifications.get('agent-1').status).toBe('completed')
    })

    it('todoDiffs computes diffs for TodoWrite events', () => {
      const { result, es } = renderEvents()

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

    it('disconnectSSE resets all derived state', () => {
      const { result, es } = renderEvents()

      sendAndFlush(
        es,
        { type: 'user', is_human: true, content: 'Hello', turn_id: 't1' },
        { type: 'assistant', subtype: 'text', content: 'Hi', turn_id: 't1' },
        { type: 'result', subtype: 'success', turn_id: 't1' },
      )

      expect(result.current.turns).toHaveLength(1)
      expect(result.current.events).toHaveLength(3)

      act(() => {
        result.current.disconnectSSE()
      })

      expect(result.current.events).toHaveLength(0)
      expect(result.current.visibleEvents).toHaveLength(0)
      expect(result.current.turns).toHaveLength(0)
      expect(result.current.turnResults).toEqual({})
      expect(result.current.taskNotifications.size).toBe(0)
      expect(result.current.todoDiffs.size).toBe(0)
    })

    it('second FLUSH_BATCH preserves first batch and appends incrementally', () => {
      const { result, es } = renderEvents()

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
      const { result } = renderEvents()
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
      const { result } = renderEvents()
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
      const { result } = renderEvents()
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
      const { result } = renderEvents()
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
      const { result } = renderEvents()
      const before = MockEventSource.instances.length

      act(() => {
        result.current.subscribeSession('session-b', null, vi.fn())
      })

      expect(MockEventSource.instances.length).toBe(before)
    })

    it('composes session_id and replay=false on the same query string', () => {
      const { result } = renderEvents()

      act(() => {
        result.current.subscribeSession('session-b', 'container-b', vi.fn(), { replay: false })
      })

      expect(getLatestEventSource().url).toBe(
        '/api/workspaces/test-workspace/containers/container-b/api/stream?session_id=session-b&replay=false',
      )
    })

    it('surfaces onError once the keyed stream exhausts its reconnect attempts, and only once', () => {
      const onError = vi.fn()
      const { result } = renderEvents()

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
