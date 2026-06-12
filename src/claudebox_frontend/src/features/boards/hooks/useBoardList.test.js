/** Tests for useBoardList hook. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useBoardList from './useBoardList'

const mockListBoards = vi.fn()
vi.mock('../../../api/boards', () => ({
  listBoards: (...args) => mockListBoards(...args),
}))

const mockWorkspaceCtx = { workspaceId: 'test-ws' }
vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspaceCtx,
}))

describe('useBoardList', () => {
  beforeEach(() => {
    mockListBoards.mockReset()
    mockWorkspaceCtx.workspaceId = 'test-ws'
  })

  it('fetches boards on mount and sets loading to false', async () => {
    mockListBoards.mockResolvedValue({
      boards: [{ id: 'b1', name: 'Board 1', path: '/a.yaml' }],
    })

    const { result } = renderHook(() => useBoardList())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.boards).toEqual([{ id: 'b1', name: 'Board 1', path: '/a.yaml' }])
    expect(result.current.error).toBeNull()
  })

  it('handles API error', async () => {
    mockListBoards.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useBoardList())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
    expect(result.current.boards).toEqual([])
  })

  it('defaults to empty array when response has no boards field', async () => {
    mockListBoards.mockResolvedValue({})

    const { result } = renderHook(() => useBoardList())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.boards).toEqual([])
  })

  it('refresh re-fetches boards', async () => {
    mockListBoards.mockResolvedValue({ boards: [{ id: 'b1', name: 'A', path: '/a' }] })

    const { result } = renderHook(() => useBoardList())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    mockListBoards.mockResolvedValue({
      boards: [
        { id: 'b1', name: 'A', path: '/a' },
        { id: 'b2', name: 'B', path: '/b' },
      ],
    })

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.boards).toHaveLength(2)
  })

  it('does not call listBoards when workspaceId is null', async () => {
    mockWorkspaceCtx.workspaceId = null
    mockListBoards.mockResolvedValue({ boards: [] })

    const { result } = renderHook(() => useBoardList())

    // Wait a tick to let any (incorrect) effect fire
    await act(async () => {
      await new Promise(r => setTimeout(r, 10))
    })

    expect(mockListBoards).not.toHaveBeenCalled()
    // Loading stays true pre-workspace - no error surfaced
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()
  })
})
