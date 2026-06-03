/** Tests for LogsStreamContext — provider-scoped logs SSE. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogsStreamProvider, useLogsStream } from './LogsStreamContext'

// Mock dependencies
vi.mock('./EventsContext', () => ({
  useEvents: () => ({ isResuming: false, isReplaying: false, containerId: 'ctr-1' }),
}))

vi.mock('../api/apiClient', () => ({
  getWorkspaceId: () => 'ws-1',
}))

vi.mock('../hooks/useSSE', () => ({
  default: () => ({ connectionStatus: 'connected', connectionError: null }),
}))

describe('LogsStreamContext', () => {
  it('provides logs stream data to consumers', () => {
    const { result } = renderHook(() => useLogsStream(), {
      wrapper: ({ children }) => <LogsStreamProvider>{children}</LogsStreamProvider>,
    })

    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.logs).toEqual([])
    expect(result.current.containerId).toBe('ctr-1')
  })

  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useLogsStream())
    }).toThrow('useLogsStream must be used within LogsStreamProvider')
  })
})
