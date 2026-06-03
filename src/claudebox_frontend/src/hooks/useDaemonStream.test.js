/** Tests for useDaemonStream hook. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useDaemonStream from './useDaemonStream'

let mockOnMessage = null
let mockConnectionStatus = 'disconnected'

vi.mock('./useSSE', () => ({
  default: ({ onMessage }) => {
    mockOnMessage = onMessage
    return { connectionStatus: mockConnectionStatus }
  },
}))

describe('useDaemonStream', () => {
  beforeEach(() => {
    mockOnMessage = null
    mockConnectionStatus = 'disconnected'
  })

  it('returns correct initial state', () => {
    const { result } = renderHook(() => useDaemonStream())

    expect(result.current.progressMessage).toBeNull()
    expect(result.current.sessionsChanged).toBe(0)
    expect(result.current.containerStatus).toBe(0)
    expect(result.current.lastContainerEvent).toBeNull()
    expect(result.current.lastSessionsChangedContainerId).toBeNull()
    expect(result.current.daemonConnected).toBe(false)
    expect(result.current.daemonReconnected).toBe(0)
  })

  it('sets progressMessage on session_progress event', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({ data: JSON.stringify({ type: 'session_progress', message: 'Loading...' }) })
    })

    expect(result.current.progressMessage).toBe('Loading...')
  })

  it('increments sessionsChanged on sessions_changed event', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({ data: JSON.stringify({ type: 'sessions_changed' }) })
    })

    expect(result.current.sessionsChanged).toBe(1)

    act(() => {
      mockOnMessage({ data: JSON.stringify({ type: 'sessions_changed' }) })
    })

    expect(result.current.sessionsChanged).toBe(2)
  })

  it('sets lastSessionsChangedContainerId from sessions_changed event', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({
        data: JSON.stringify({ type: 'sessions_changed', container_id: 'abc-123' }),
      })
    })

    expect(result.current.lastSessionsChangedContainerId).toBe('abc-123')
  })

  it('sets lastSessionsChangedContainerId to null when container_id is absent', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({ data: JSON.stringify({ type: 'sessions_changed' }) })
    })

    expect(result.current.lastSessionsChangedContainerId).toBeNull()
  })

  it('sets lastContainerEvent and increments containerStatus on container_status event', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({
        data: JSON.stringify({ type: 'container_status', container_id: 'c1', status: 'running' }),
      })
    })

    expect(result.current.lastContainerEvent).toEqual({ containerId: 'c1', status: 'running' })
    expect(result.current.containerStatus).toBe(1)

    act(() => {
      mockOnMessage({
        data: JSON.stringify({ type: 'container_status', container_id: 'c2', status: 'stopped' }),
      })
    })

    expect(result.current.lastContainerEvent).toEqual({ containerId: 'c2', status: 'stopped' })
    expect(result.current.containerStatus).toBe(2)
  })

  it('clears progressMessage when clearProgress is called', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({ data: JSON.stringify({ type: 'session_progress', message: 'Working...' }) })
    })

    expect(result.current.progressMessage).toBe('Working...')

    act(() => {
      result.current.clearProgress()
    })

    expect(result.current.progressMessage).toBeNull()
  })

  it('ignores malformed JSON without crashing', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({ data: 'not-valid-json{{{' })
    })

    expect(result.current.progressMessage).toBeNull()
    expect(result.current.sessionsChanged).toBe(0)
  })

  it('reflects daemonConnected as true when connectionStatus is connected', () => {
    mockConnectionStatus = 'connected'
    const { result } = renderHook(() => useDaemonStream())

    expect(result.current.daemonConnected).toBe(true)
  })

  it('reflects daemonConnected as false when connectionStatus is not connected', () => {
    mockConnectionStatus = 'connecting'
    const { result } = renderHook(() => useDaemonStream())

    expect(result.current.daemonConnected).toBe(false)
  })

  it('increments daemonReconnected on reconnection (not initial connection)', () => {
    mockConnectionStatus = 'disconnected'
    const { result, rerender } = renderHook(() => useDaemonStream())

    // Initial connection should not trigger reconnection counter
    mockConnectionStatus = 'connected'
    rerender()

    expect(result.current.daemonReconnected).toBe(0)

    // Disconnect then reconnect should trigger it
    mockConnectionStatus = 'disconnected'
    rerender()

    mockConnectionStatus = 'connected'
    rerender()

    expect(result.current.daemonReconnected).toBe(1)
  })

  it('does not increment daemonReconnected when status stays connected across rerenders', () => {
    mockConnectionStatus = 'connected'
    const { result, rerender } = renderHook(() => useDaemonStream())

    rerender()
    rerender()

    expect(result.current.daemonReconnected).toBe(0)
  })
})
