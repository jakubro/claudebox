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

describe('useCurrentBackendId', () => {
  beforeEach(() => {
    mockEvents.containerId = null
    mockWorkspace.workspaceId = null
    mockStream.lastContainerEvent = null
    global.fetch = vi.fn()
  })

  it('stays null when there is no workspace or container attached', () => {
    const { result } = renderHook(() => useCurrentBackendId())

    expect(result.current).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('resolves the backend id once workspace and container are both set', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ backend_id: 'backend-abc' }),
    })

    const { result } = renderHook(() => useCurrentBackendId())

    await waitFor(() => {
      expect(result.current).toBe('backend-abc')
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/ws-1/containers/c-1')
  })

  it('does not parse the response body when the fetch response is not ok', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    const jsonSpy = vi.fn()
    global.fetch.mockResolvedValue({ ok: false, json: jsonSpy })

    renderHook(() => useCurrentBackendId())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })
    // Let the resolved-fetch promise chain run past the ok-check.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('falls back to null when a subsequent fetch rejects', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ backend_id: 'backend-abc' }),
    })

    const { result, rerender } = renderHook(() => useCurrentBackendId())
    await waitFor(() => {
      expect(result.current).toBe('backend-abc')
    })

    global.fetch.mockRejectedValueOnce(new Error('network down'))
    mockEvents.containerId = 'c-2'
    rerender()

    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })

  it('resets to null when the container detaches', async () => {
    mockWorkspace.workspaceId = 'ws-1'
    mockEvents.containerId = 'c-1'
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ backend_id: 'backend-abc' }),
    })

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
