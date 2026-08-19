/** Tests for useContainerList - fetch, workspace gating, and container_status event patching. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useContainerList from './useContainerList'

vi.mock('../../../api/containers', () => ({
  listContainers: vi.fn(),
}))

import { listContainers } from '../../../api/containers'

const mockStream = { lastContainerEvent: null }
vi.mock('../../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => mockStream,
}))

const mockWorkspace = { workspaceId: 'ws-1' }
vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace,
}))

describe('useContainerList', () => {
  beforeEach(() => {
    listContainers.mockReset()
    mockStream.lastContainerEvent = null
    mockWorkspace.workspaceId = 'ws-1'
  })

  it('fetches and exposes the container list', async () => {
    listContainers.mockResolvedValue({ containers: [{ id: 'c1', status: 'running' }] })

    const { result } = renderHook(() => useContainerList())
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.containers).toEqual([{ id: 'c1', status: 'running' }])
    expect(result.current.error).toBeNull()
  })

  it('defaults to an empty list when the response has no containers field', async () => {
    listContainers.mockResolvedValue({})

    const { result } = renderHook(() => useContainerList())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.containers).toEqual([])
  })

  it('does not fetch and clears containers without an active workspace', async () => {
    mockWorkspace.workspaceId = null

    const { result } = renderHook(() => useContainerList())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.containers).toEqual([])
    expect(listContainers).not.toHaveBeenCalled()
  })

  it('surfaces a fetch error', async () => {
    const error = new Error('Failed to list containers: 500')
    listContainers.mockRejectedValue(error)

    const { result } = renderHook(() => useContainerList())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe(error)
    expect(result.current.containers).toEqual([])
  })

  it('patches a matching container status from a container_status event', async () => {
    listContainers.mockResolvedValue({
      containers: [
        { id: 'c1', status: 'starting' },
        { id: 'c2', status: 'running' },
      ],
    })

    const { result, rerender } = renderHook(() => useContainerList())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    mockStream.lastContainerEvent = { containerId: 'c1', status: 'running' }
    rerender()

    await waitFor(() => {
      expect(result.current.containers.find(c => c.id === 'c1').status).toBe('running')
    })
    expect(result.current.containers.find(c => c.id === 'c2').status).toBe('running')
  })

  it('ignores a repeated identical container event', async () => {
    listContainers.mockResolvedValue({ containers: [{ id: 'c1', status: 'starting' }] })

    const { result, rerender } = renderHook(() => useContainerList())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const event = { containerId: 'c1', status: 'running' }
    mockStream.lastContainerEvent = event
    rerender()
    await waitFor(() => {
      expect(result.current.containers[0].status).toBe('running')
    })
    const containersAfterFirst = result.current.containers

    // Same event reference again - the ref-equality guard should skip re-mapping.
    rerender()
    expect(result.current.containers).toBe(containersAfterFirst)
  })

  it('exposes a manual refresh action', async () => {
    listContainers.mockResolvedValue({ containers: [] })
    const { result } = renderHook(() => useContainerList())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    listContainers.mockResolvedValue({ containers: [{ id: 'c9', status: 'running' }] })
    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.containers).toEqual([{ id: 'c9', status: 'running' }])
    })
  })
})
