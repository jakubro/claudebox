/** Tests for useBoardData hook. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useBoardData from './useBoardData'

const mockGetBoard = vi.fn()
vi.mock('../../../api/boards', () => ({
  getBoard: (...args) => mockGetBoard(...args),
}))

const mockStreamContext = { sessionsChanged: 0, containerStatus: 0 }
vi.mock('../../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => mockStreamContext,
}))

describe('useBoardData', () => {
  beforeEach(() => {
    mockGetBoard.mockReset()
    mockStreamContext.sessionsChanged = 0
    mockStreamContext.containerStatus = 0
  })

  it('fetches board data on mount', async () => {
    const boardData = { id: 'b1', name: 'Sprint', columns: [] }
    mockGetBoard.mockResolvedValue(boardData)

    const { result } = renderHook(() => useBoardData('b1'))

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.board).toEqual(boardData)
    expect(result.current.error).toBeNull()
    expect(mockGetBoard).toHaveBeenCalledWith('b1')
  })

  it('does not fetch when boardId is null', async () => {
    const { result } = renderHook(() => useBoardData(null))

    await waitFor(() => {
      expect(mockGetBoard).not.toHaveBeenCalled()
    })

    expect(result.current.board).toBeNull()
  })

  it('handles API error', async () => {
    mockGetBoard.mockRejectedValue(new Error('Failed to fetch board'))

    const { result } = renderHook(() => useBoardData('b1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Failed to fetch board')
    expect(result.current.board).toBeNull()
  })

  it('re-fetches when sessionsChanged increments', async () => {
    const boardData = { id: 'b1', name: 'Sprint', columns: [] }
    mockGetBoard.mockResolvedValue(boardData)

    const { result, rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockGetBoard).toHaveBeenCalledTimes(1)

    mockStreamContext.sessionsChanged = 1
    rerender({ id: 'b1' })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledTimes(2)
    })
  })

  it('re-fetches when containerStatus increments', async () => {
    const boardData = { id: 'b1', name: 'Sprint', columns: [] }
    mockGetBoard.mockResolvedValue(boardData)

    const { result, rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockGetBoard).toHaveBeenCalledTimes(1)

    mockStreamContext.containerStatus = 1
    rerender({ id: 'b1' })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledTimes(2)
    })
  })

  it('re-fetches when boardId changes', async () => {
    mockGetBoard.mockResolvedValue({ id: 'b1', name: 'Board 1' })

    const { result, rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    mockGetBoard.mockResolvedValue({ id: 'b2', name: 'Board 2' })
    rerender({ id: 'b2' })

    await waitFor(() => {
      expect(result.current.board).toEqual({ id: 'b2', name: 'Board 2' })
    })

    expect(mockGetBoard).toHaveBeenCalledWith('b2')
  })

  it('refresh re-fetches board data', async () => {
    mockGetBoard.mockResolvedValue({ id: 'b1', name: 'Sprint', columns: [] })

    const { result } = renderHook(() => useBoardData('b1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const updatedBoard = { id: 'b1', name: 'Sprint', columns: ['todo'] }
    mockGetBoard.mockResolvedValue(updatedBoard)

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.board).toEqual(updatedBoard)
  })
})
