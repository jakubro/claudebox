/** Tests for LogsStreamContext - provider-scoped logs SSE. */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogsStreamProvider, useLogsStream } from './LogsStreamContext'

vi.mock('./EventsContext', () => ({
  useEvents: () => ({ isResuming: false, isReplaying: false, containerId: 'ctr-1' }),
}))

vi.mock('../api/apiClient', () => ({
  getWorkspaceId: () => 'ws-1',
}))

let sendFrame = null
vi.mock('../hooks/useSSE', () => ({
  default: ({ onMessage }) => {
    sendFrame = frame => onMessage({ data: JSON.stringify(frame) })
    return { connectionStatus: 'connected', connectionError: null }
  },
}))

const logLine = (n, level = 'INFO') => ({
  timestamp: n,
  level,
  logger: 'app',
  message: `line ${n}`,
  source: 'api',
  stream: null,
  extra: null,
})

function renderCountedStream() {
  const counter = { renders: 0 }
  const hook = renderHook(
    () => {
      counter.renders += 1
      return useLogsStream()
    },
    { wrapper: ({ children }) => <LogsStreamProvider>{children}</LogsStreamProvider> },
  )
  return { ...hook, counter }
}

const send = frame => act(() => sendFrame(frame))

describe('LogsStreamContext', () => {
  it('provides logs stream data to consumers', () => {
    const { result } = renderHook(() => useLogsStream(), {
      wrapper: ({ children }) => <LogsStreamProvider>{children}</LogsStreamProvider>,
    })

    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.logs).toEqual([])
    expect(result.current.containerId).toBe('ctr-1')
  })

  it('applies a replay in one update when it ends', () => {
    const { result, counter } = renderCountedStream()

    send({ type: 'system', subtype: 'replay_started', count: 50 })
    const rendersBefore = counter.renders
    for (let n = 0; n < 50; n++) {
      send(logLine(n))
    }

    expect(counter.renders).toBe(rendersBefore)
    expect(result.current.logs).toEqual([])

    send({ type: 'system', subtype: 'replay_ended', count: 0 })

    expect(counter.renders).toBe(rendersBefore + 1)
    expect(result.current.logs.map(l => l.message)).toEqual(
      Array.from({ length: 50 }, (_, n) => `line ${n}`),
    )
  })

  it('marks unread errors when a replayed line is an error', () => {
    const { result } = renderCountedStream()

    send({ type: 'system', subtype: 'replay_started', count: 2 })
    send(logLine(1))
    send(logLine(2, 'ERROR'))
    send({ type: 'system', subtype: 'replay_ended', count: 0 })

    expect(result.current.hasUnreadErrors).toBe(true)
  })

  it('appends live lines one at a time after the replay', () => {
    const { result } = renderCountedStream()
    send({ type: 'system', subtype: 'replay_started', count: 0 })
    send({ type: 'system', subtype: 'replay_ended', count: 0 })

    send(logLine(1))
    expect(result.current.logs).toHaveLength(1)
    send(logLine(2))
    expect(result.current.logs).toHaveLength(2)
  })

  it('keeps only the latest thousand lines', () => {
    const { result } = renderCountedStream()

    send({ type: 'system', subtype: 'replay_started', count: 1200 })
    for (let n = 0; n < 1200; n++) {
      send(logLine(n))
    }
    send({ type: 'system', subtype: 'replay_ended', count: 0 })

    expect(result.current.logs).toHaveLength(1000)
    expect(result.current.logs[0].message).toBe('line 200')
  })

  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useLogsStream())
    }).toThrow('useLogsStream must be used within LogsStreamProvider')
  })
})
