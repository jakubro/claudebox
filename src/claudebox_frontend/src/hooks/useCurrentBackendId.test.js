/** Tests for useCurrentBackendId - resolves the backend id from workspace + container. */

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useCurrentBackendId from './useCurrentBackendId'

const mockEvents = { containerId: null }
vi.mock('../context/EventsContext', () => ({
  useEvents: () => mockEvents,
}))

const mockWorkspace = { workspaceId: null }
vi.mock('../context/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace,
}))

const mockStream = { lastContainerEvent: null }
vi.mock('../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => mockStream,
}))

const mockGetContainer = vi.fn()
vi.mock('../api/containers', () => ({
  getContainer: (...args) => mockGetContainer(...args),
}))

describe('useCurrentBackendId', () => {
  beforeEach(() => {
    mockEvents.containerId = null
    mockWorkspace.workspaceId = null
    mockStream.lastContainerEvent = null
    mockGetContainer.mockReset()
  })

  it('stays null when there is no workspace or container attached', () => {
    const { result } = renderHook(() => useCurrentBackendId())

    expect(result.current).toBeNull()
    expect(mockGetContainer).not.toHaveBeenCalled()
  })

  it('resolves the backend id once workspace and container are both set', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    mockGetContainer.mockResolvedValue({ backend_id: 'backend-abc' })

    const { result } = renderHook(() => useCurrentBackendId())

    await waitFor(() => {
      expect(result.current).toBe('backend-abc')
    })

    expect(mockGetContainer).toHaveBeenCalledWith('c-1', { signal: expect.any(AbortSignal) })
  })

  it('aborts the in-flight lookup when the container changes', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    mockGetContainer.mockReturnValue(new Promise(() => {}))

    const { rerender } = renderHook(() => useCurrentBackendId())

    await waitFor(() => {
      expect(mockGetContainer).toHaveBeenCalledTimes(1)
    })
    const { signal } = mockGetContainer.mock.calls[0][1]
    expect(signal.aborted).toBe(false)

    mockEvents.containerId = 'c-2'
    rerender()

    expect(signal.aborted).toBe(true)
  })

  it('falls back to null when a subsequent lookup rejects', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    mockGetContainer.mockResolvedValueOnce({ backend_id: 'backend-abc' })

    const { result, rerender } = renderHook(() => useCurrentBackendId())
    await waitFor(() => {
      expect(result.current).toBe('backend-abc')
    })

    mockGetContainer.mockRejectedValueOnce(new Error('network down'))
    mockEvents.containerId = 'c-2'
    rerender()

    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })

  it('resets to null when the container detaches', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    mockGetContainer.mockResolvedValue({ backend_id: 'backend-abc' })

    const { result, rerender } = renderHook(() => useCurrentBackendId())
    await waitFor(() => {
      expect(result.current).toBe('backend-abc')
    })

    mockEvents.containerId = null
    rerender()

    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })
})
