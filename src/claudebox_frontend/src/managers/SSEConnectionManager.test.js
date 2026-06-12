/** Tests for SSEConnectionManager class. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SSEConnectionManager from './SSEConnectionManager'

// Mock EventSource
class MockEventSource {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    MockEventSource.instances.push(this)
  }

  close() {
    this.readyState = 2
  }

  simulateOpen() {
    this.readyState = 1
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

describe('SSEConnectionManager', () => {
  let originalEventSource
  let onStatusChange
  let onMessage
  let manager

  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.instances = []
    originalEventSource = global.EventSource
    global.EventSource = MockEventSource
    onStatusChange = vi.fn()
    onMessage = vi.fn()
    manager = new SSEConnectionManager({
      url: '/api/stream',
      baseDelay: 1000,
      maxDelay: 10000,
      onStatusChange,
      onMessage,
    })
  })

  afterEach(() => {
    manager.disconnect()
    vi.useRealTimers()
    global.EventSource = originalEventSource
  })

  const latestES = () => MockEventSource.instances[MockEventSource.instances.length - 1]

  describe('initial state', () => {
    it('starts disconnected with no error', () => {
      expect(manager.status).toBe('disconnected')
      expect(manager.error).toBeNull()
      expect(manager.isConnected).toBe(false)
    })

    it('does not create EventSource until connect()', () => {
      expect(MockEventSource.instances).toHaveLength(0)
    })
  })

  describe('connect', () => {
    it('creates EventSource with configured URL', () => {
      manager.connect()

      expect(MockEventSource.instances).toHaveLength(1)
      expect(latestES().url).toBe('/api/stream')
    })

    it('transitions to connecting immediately', () => {
      manager.connect()

      expect(manager.status).toBe('connecting')
      expect(onStatusChange).toHaveBeenCalledWith('connecting', null)
    })

    it('transitions to connected on open', () => {
      manager.connect()
      latestES().simulateOpen()

      expect(manager.status).toBe('connected')
      expect(manager.isConnected).toBe(true)
      expect(onStatusChange).toHaveBeenCalledWith('connected', null)
    })

    it('is no-op when already connecting', () => {
      manager.connect()
      manager.connect()

      expect(MockEventSource.instances).toHaveLength(1)
    })

    it('is no-op when already connected', () => {
      manager.connect()
      latestES().simulateOpen()

      manager.connect()

      expect(MockEventSource.instances).toHaveLength(1)
    })

    it('forwards SSE messages to onMessage callback', () => {
      manager.connect()
      latestES().simulateOpen()

      const messageEvent = { data: '{"type":"user"}' }
      latestES().onmessage(messageEvent)

      expect(onMessage).toHaveBeenCalledWith(messageEvent)
    })
  })

  describe('disconnect', () => {
    it('closes EventSource', () => {
      manager.connect()
      const es = latestES()

      manager.disconnect()

      expect(es.readyState).toBe(2)
    })

    it('transitions to disconnected', () => {
      manager.connect()
      latestES().simulateOpen()

      manager.disconnect()

      expect(manager.status).toBe('disconnected')
      expect(manager.isConnected).toBe(false)
    })

    it('cancels pending reconnect timer', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      const countAfterError = MockEventSource.instances.length

      manager.disconnect()

      vi.advanceTimersByTime(10000)

      expect(MockEventSource.instances).toHaveLength(countAfterError)
    })

    it('is safe to call when already disconnected', () => {
      expect(() => manager.disconnect()).not.toThrow()
      expect(manager.status).toBe('disconnected')
    })

    it('clears error on disconnect', () => {
      manager.connect()
      latestES().simulateError()

      expect(manager.status).toBe('reconnecting')
      expect(manager.error).toBe('Connection lost')

      manager.disconnect()

      expect(manager.error).toBeNull()
    })
  })

  describe('error and auto-reconnect', () => {
    it('transitions to reconnecting on SSE error', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      expect(manager.status).toBe('reconnecting')
      expect(manager.error).toBe('Connection lost')
      expect(manager.isConnected).toBe(false)
      expect(onStatusChange).toHaveBeenCalledWith('reconnecting', 'Connection lost')
    })

    it('closes EventSource on error', () => {
      manager.connect()
      const es = latestES()
      es.simulateOpen()
      es.simulateError()

      expect(es.readyState).toBe(2)
    })

    it('auto-reconnects after base delay on first attempt', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      expect(MockEventSource.instances).toHaveLength(1)

      vi.advanceTimersByTime(1000)

      expect(MockEventSource.instances).toHaveLength(2)
      expect(manager.status).toBe('connecting')
    })

    it('does not reconnect before delay elapses', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      vi.advanceTimersByTime(999)

      expect(MockEventSource.instances).toHaveLength(1)
    })

    it('uses exponential backoff: 1s, 2s, 4s, 8s, 10s cap', () => {
      manager.connect()
      latestES().simulateOpen()

      // Attempt 0: 1s
      latestES().simulateError()
      vi.advanceTimersByTime(1000)
      expect(MockEventSource.instances).toHaveLength(2)

      // Attempt 1: 2s
      latestES().simulateError()
      vi.advanceTimersByTime(2000)
      expect(MockEventSource.instances).toHaveLength(3)

      // Attempt 2: 4s
      latestES().simulateError()
      vi.advanceTimersByTime(4000)
      expect(MockEventSource.instances).toHaveLength(4)

      // Attempt 3: 8s
      latestES().simulateError()
      vi.advanceTimersByTime(8000)
      expect(MockEventSource.instances).toHaveLength(5)

      // Attempt 4: 10s (capped at maxDelay)
      latestES().simulateError()
      vi.advanceTimersByTime(10000)
      expect(MockEventSource.instances).toHaveLength(6)

      // Attempt 5: still 10s cap
      latestES().simulateError()
      vi.advanceTimersByTime(10000)
      expect(MockEventSource.instances).toHaveLength(7)
    })

    it('resets attempt counter on successful connect', () => {
      manager.connect()
      latestES().simulateOpen()

      // First error: 1s (attempt 0)
      latestES().simulateError()
      vi.advanceTimersByTime(1000)
      expect(MockEventSource.instances).toHaveLength(2)

      // Successful reconnect resets counter
      latestES().simulateOpen()
      latestES().simulateError()

      // Back to 1s (attempt 0 again, not 2s)
      vi.advanceTimersByTime(1000)
      expect(MockEventSource.instances).toHaveLength(3)
    })

    it('clears error on successful reconnect', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      vi.advanceTimersByTime(1000)

      latestES().simulateOpen()

      expect(manager.status).toBe('connected')
      expect(manager.error).toBeNull()
    })

    it('handles consecutive errors with repeated reconnects', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      vi.advanceTimersByTime(1000) // attempt 0
      latestES().simulateOpen()
      latestES().simulateError()

      vi.advanceTimersByTime(1000) // attempt 0 again (reset on connect)

      expect(MockEventSource.instances).toHaveLength(3)
      expect(manager.status).toBe('connecting')
    })
  })

  describe('reconnect', () => {
    it('closes existing connection and opens new one', () => {
      manager.connect()
      const first = latestES()
      first.simulateOpen()

      manager.reconnect()

      expect(first.readyState).toBe(2)
      expect(MockEventSource.instances).toHaveLength(2)
      expect(manager.status).toBe('connecting')
    })

    it('cancels pending auto-reconnect', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      const countAfterError = MockEventSource.instances.length

      manager.reconnect()

      const countAfterReconnect = MockEventSource.instances.length
      expect(countAfterReconnect).toBe(countAfterError + 1)

      vi.advanceTimersByTime(10000)

      expect(MockEventSource.instances).toHaveLength(countAfterReconnect)
    })

    it('works when disconnected', () => {
      manager.reconnect()

      expect(MockEventSource.instances).toHaveLength(1)
      expect(manager.status).toBe('connecting')
    })

    it('new connection receives messages', () => {
      manager.connect()
      latestES().simulateOpen()

      manager.reconnect()
      latestES().simulateOpen()

      const msg = { data: '{"type":"assistant"}' }
      latestES().onmessage(msg)

      expect(onMessage).toHaveBeenCalledWith(msg)
    })
  })

  describe('close (permanent)', () => {
    it('transitions to disconnected', () => {
      manager.connect()
      latestES().simulateOpen()

      manager.close()

      expect(manager.status).toBe('disconnected')
      expect(manager.isConnected).toBe(false)
    })

    it('closes EventSource', () => {
      manager.connect()
      const es = latestES()
      es.simulateOpen()

      manager.close()

      expect(es.readyState).toBe(2)
    })

    it('prevents connect() after close', () => {
      manager.close()
      manager.connect()

      expect(MockEventSource.instances).toHaveLength(0)
      expect(manager.status).toBe('disconnected')
    })

    it('prevents reconnect() after close', () => {
      manager.close()
      manager.reconnect()

      expect(MockEventSource.instances).toHaveLength(0)
    })

    it('cancels pending reconnect timer', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      const countAfterError = MockEventSource.instances.length

      manager.close()

      vi.advanceTimersByTime(10000)

      expect(MockEventSource.instances).toHaveLength(countAfterError)
    })

    it('suppresses auto-reconnect after error when closed during reconnecting', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      expect(manager.status).toBe('reconnecting')

      manager.close()

      vi.advanceTimersByTime(10000)

      // No new EventSource created
      expect(MockEventSource.instances).toHaveLength(1)
      expect(manager.status).toBe('disconnected')
    })
  })

  describe('reconnect exhaustion', () => {
    it('stops reconnecting after maxAttempts and transitions to error', () => {
      const onExhausted = vi.fn()
      const limited = new SSEConnectionManager({
        url: '/api/stream',
        baseDelay: 1000,
        maxDelay: 10000,
        maxAttempts: 2,
        onStatusChange,
        onReconnectExhausted: onExhausted,
      })

      limited.connect()
      latestES().simulateOpen()

      // Attempt 0
      latestES().simulateError()
      vi.advanceTimersByTime(1000)
      expect(MockEventSource.instances).toHaveLength(2)

      // Attempt 1
      latestES().simulateError()
      vi.advanceTimersByTime(2000)
      expect(MockEventSource.instances).toHaveLength(3)

      // Attempt 2 - exhausted, no new EventSource
      latestES().simulateError()
      vi.advanceTimersByTime(10000)
      expect(MockEventSource.instances).toHaveLength(3)

      expect(limited.status).toBe('error')
      expect(limited.error).toBe('Connection lost - container may be unavailable')
      expect(onExhausted).toHaveBeenCalledOnce()

      limited.disconnect()
    })

    it('does not fire onReconnectExhausted when maxAttempts is null', () => {
      const onExhausted = vi.fn()
      const unlimited = new SSEConnectionManager({
        url: '/api/stream',
        baseDelay: 100,
        maxDelay: 200,
        onStatusChange,
        onReconnectExhausted: onExhausted,
      })

      unlimited.connect()
      latestES().simulateOpen()

      // 5 consecutive failures - should keep reconnecting
      for (let i = 0; i < 5; i++) {
        latestES().simulateError()
        vi.advanceTimersByTime(200)
      }

      expect(MockEventSource.instances.length).toBeGreaterThan(5)
      expect(onExhausted).not.toHaveBeenCalled()

      unlimited.disconnect()
    })

    it('resets attempt counter on successful connect with maxAttempts', () => {
      const onExhausted = vi.fn()
      const limited = new SSEConnectionManager({
        url: '/api/stream',
        baseDelay: 1000,
        maxDelay: 10000,
        maxAttempts: 2,
        onStatusChange,
        onReconnectExhausted: onExhausted,
      })

      limited.connect()
      latestES().simulateOpen()

      // Use 1 attempt
      latestES().simulateError()
      vi.advanceTimersByTime(1000)

      // Reconnect succeeds - counter resets
      latestES().simulateOpen()

      // 2 more failures should be allowed again
      latestES().simulateError()
      vi.advanceTimersByTime(1000)
      latestES().simulateError()
      vi.advanceTimersByTime(2000)

      // Now exhausted
      latestES().simulateError()
      expect(onExhausted).toHaveBeenCalledOnce()

      limited.disconnect()
    })
  })

  describe('options defaults', () => {
    it('uses default URL and delay when no options provided', () => {
      const defaultMgr = new SSEConnectionManager()
      defaultMgr.connect()

      expect(latestES().url).toBe('/api/stream')

      latestES().simulateOpen()
      latestES().simulateError()

      // Default base delay is 1000ms
      vi.advanceTimersByTime(1000)

      expect(MockEventSource.instances).toHaveLength(2)

      defaultMgr.disconnect()
    })

    it('accepts custom baseDelay', () => {
      const fastMgr = new SSEConnectionManager({ baseDelay: 500, maxDelay: 5000 })
      fastMgr.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      vi.advanceTimersByTime(499)
      expect(MockEventSource.instances).toHaveLength(1)

      vi.advanceTimersByTime(1)
      expect(MockEventSource.instances).toHaveLength(2)

      fastMgr.disconnect()
    })
  })

  describe('status change notifications', () => {
    it('notifies on full lifecycle: connect -> connected -> reconnecting -> reconnect -> connected', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()
      vi.advanceTimersByTime(1000)
      latestES().simulateOpen()

      expect(onStatusChange.mock.calls.map(c => c[0])).toEqual([
        'connecting',
        'connected',
        'reconnecting',
        'connecting',
        'connected',
      ])
    })

    it('includes error message only for reconnecting status', () => {
      manager.connect()
      latestES().simulateOpen()
      latestES().simulateError()

      const reconnectingCall = onStatusChange.mock.calls.find(c => c[0] === 'reconnecting')
      const connectedCall = onStatusChange.mock.calls.find(c => c[0] === 'connected')

      expect(reconnectingCall[1]).toBe('Connection lost')
      expect(connectedCall[1]).toBeNull()
    })
  })
})
