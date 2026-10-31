/** Tests for useDaemonStream hook. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDaemonCommit } from '../api/daemon'
import useDaemonStream from './useDaemonStream'

let mockOnMessage = null
let mockConnectionStatus = 'disconnected'

vi.mock('../api/daemon', () => ({ fetchDaemonCommit: vi.fn() }))

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
    fetchDaemonCommit.mockReset()
    fetchDaemonCommit.mockResolvedValue('aaaaaaa')
  })

  it('returns correct initial state', () => {
    const { result } = renderHook(() => useDaemonStream())

    expect(result.current.progressMessage).toBeNull()
    expect(result.current.sessionsChanged).toBe(0)
    expect(result.current.changesByWorkspace).toEqual({})
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

  it('sets lastContainerEvent on container_status event', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({
        data: JSON.stringify({ type: 'container_status', container_id: 'c1', status: 'running' }),
      })
    })

    expect(result.current.lastContainerEvent).toEqual({ containerId: 'c1', status: 'running' })

    act(() => {
      mockOnMessage({
        data: JSON.stringify({ type: 'container_status', container_id: 'c2', status: 'stopped' }),
      })
    })

    expect(result.current.lastContainerEvent).toEqual({ containerId: 'c2', status: 'stopped' })
  })

  it('counts sessions and container changes per workspace', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({ data: JSON.stringify({ type: 'sessions_changed', workspace_id: 'ws-a' }) })
      mockOnMessage({
        data: JSON.stringify({
          type: 'container_status',
          workspace_id: 'ws-a',
          container_id: 'c1',
          status: 'running',
        }),
      })
      mockOnMessage({ data: JSON.stringify({ type: 'sessions_changed', workspace_id: 'ws-b' }) })
    })

    expect(result.current.changesByWorkspace).toEqual({ 'ws-a': 2, 'ws-b': 1 })
    expect(result.current.sessionsChanged).toBe(2)
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

  it('increments daemonReconnected on reconnection (not initial connection)', async () => {
    mockConnectionStatus = 'disconnected'
    const { result, rerender } = renderHook(() => useDaemonStream())

    // Initial connection should not trigger reconnection counter
    mockConnectionStatus = 'connected'
    rerender()
    await act(async () => {})

    expect(result.current.daemonReconnected).toBe(0)

    // Disconnect then reconnect should trigger it
    mockConnectionStatus = 'disconnected'
    rerender()

    mockConnectionStatus = 'connected'
    rerender()

    await waitFor(() => expect(result.current.daemonReconnected).toBe(1))
  })

  it('does not increment daemonReconnected when status stays connected across rerenders', () => {
    mockConnectionStatus = 'connected'
    const { result, rerender } = renderHook(() => useDaemonStream())

    rerender()
    rerender()

    expect(result.current.daemonReconnected).toBe(0)
  })

  it('counts board_update per workspace and board', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      for (const [workspace_id, board_id] of [
        ['w1', 'b1'],
        ['w1', 'b1'],
        ['w2', 'b1'],
      ]) {
        mockOnMessage({ data: JSON.stringify({ type: 'board_update', workspace_id, board_id }) })
      }
    })

    expect(result.current.boardChanges).toEqual({ 'w1/b1': 2, 'w2/b1': 1 })
  })

  it('board_update leaves changesByWorkspace and sessionsChanged untouched', () => {
    const { result } = renderHook(() => useDaemonStream())

    act(() => {
      mockOnMessage({
        data: JSON.stringify({ type: 'board_update', workspace_id: 'w1', board_id: 'b1' }),
      })
    })

    expect(result.current.changesByWorkspace).toEqual({})
    expect(result.current.sessionsChanged).toBe(0)
  })
})

describe('useDaemonStream reload on a new commit', () => {
  const reload = vi.fn()
  const realLocation = window.location

  beforeEach(() => {
    mockConnectionStatus = 'disconnected'
    reload.mockReset()
    fetchDaemonCommit.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  async function reconnectTo(firstCommit, laterCommit) {
    fetchDaemonCommit.mockResolvedValueOnce(firstCommit).mockResolvedValueOnce(laterCommit)
    const hook = renderHook(() => useDaemonStream())

    mockConnectionStatus = 'connected'
    hook.rerender()
    await act(async () => {})
    mockConnectionStatus = 'disconnected'
    hook.rerender()
    mockConnectionStatus = 'connected'
    hook.rerender()
    await waitFor(() => expect(fetchDaemonCommit).toHaveBeenCalledTimes(2))
    await act(async () => {})

    return hook.result
  }

  it('reloads once, without counting the reconnect, when the commit changed', async () => {
    const result = await reconnectTo('aaaaaaa', 'bbbbbbb')

    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.current.daemonReconnected).toBe(0)
  })

  it('recovers as before when the commit is the same', async () => {
    const result = await reconnectTo('aaaaaaa', 'aaaaaaa')

    expect(reload).not.toHaveBeenCalled()
    expect(result.current.daemonReconnected).toBe(1)
  })

  it.each([
    [null, 'bbbbbbb'],
    ['aaaaaaa', null],
  ])('never reloads when a commit is unknown (%s, then %s)', async (first, later) => {
    const result = await reconnectTo(first, later)

    expect(reload).not.toHaveBeenCalled()
    expect(result.current.daemonReconnected).toBe(1)
  })
})
