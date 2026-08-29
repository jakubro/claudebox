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

  it('coalesces signals that arrive while a request is in flight', async () => {
    let resolveFetch
    mockGetBoard.mockReturnValue(
      new Promise(resolve => {
        resolveFetch = resolve
      }),
    )

    const { rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledTimes(1)
    })

    mockStreamContext.sessionsChanged = 1
    rerender({ id: 'b1' })
    mockStreamContext.sessionsChanged = 2
    rerender({ id: 'b1' })
    mockStreamContext.containerStatus = 1
    rerender({ id: 'b1' })

    // Three signals arrived while the first request was still outstanding - none started a
    // second request; they joined the one already running.
    expect(mockGetBoard).toHaveBeenCalledTimes(1)

    resolveFetch({ id: 'b1', name: 'Sprint', columns: [] })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledTimes(2)
    })
  })

  it('re-fetches exactly once after settling, however many signals joined', async () => {
    const resolvers = []
    mockGetBoard.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvers.push(resolve)
        }),
    )

    const { rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledTimes(1)
    })

    mockStreamContext.sessionsChanged = 1
    rerender({ id: 'b1' })
    mockStreamContext.containerStatus = 1
    rerender({ id: 'b1' })

    resolvers[0]({ id: 'b1', name: 'Sprint', columns: [] })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledTimes(2)
    })

    resolvers[1]({ id: 'b1', name: 'Sprint v2', columns: [] })
    await new Promise(resolve => setTimeout(resolve, 0))

    // Two signals joined the first request; still only one re-fetch, not one per signal.
    expect(mockGetBoard).toHaveBeenCalledTimes(2)
  })

  it('does not apply the previous board response after switching boards mid-request', async () => {
    let resolveB1
    mockGetBoard.mockImplementation(id => {
      if (id === 'b1') {
        return new Promise(resolve => {
          resolveB1 = resolve
        })
      }
      return Promise.resolve({ id: 'b2', name: 'Board 2', columns: [] })
    })

    const { result, rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledWith('b1')
    })

    rerender({ id: 'b2' })

    await waitFor(() => {
      expect(result.current.board).toEqual({ id: 'b2', name: 'Board 2', columns: [] })
    })

    // Resolving b1 triggers a state update outside any render/waitFor call - act() is what
    // makes React flush it before the assertion below reads result.current.
    await act(async () => {
      resolveB1({ id: 'b1', name: 'Sprint', columns: [] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // b1's late response must not overwrite b2's already-applied state.
    expect(result.current.board).toEqual({ id: 'b2', name: 'Board 2', columns: [] })
  })

  it('keeps loading true for the new board while the previous board settles late', async () => {
    let resolveB1
    mockGetBoard.mockImplementation(id => {
      if (id === 'b1') {
        return new Promise(resolve => {
          resolveB1 = resolve
        })
      }
      return new Promise(() => {})
    })

    const { result, rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledWith('b1')
    })

    rerender({ id: 'b2' })

    await act(async () => {
      resolveB1({ id: 'b1', name: 'Sprint', columns: [] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // b1's late settle must not clear loading while b2's own fetch is still outstanding.
    expect(result.current.loading).toBe(true)
  })

  it('settles an orphaned joiner when its board is switched away, without a spurious extra fetch', async () => {
    let resolveB1
    mockGetBoard.mockImplementation(id => {
      if (id === 'b1') {
        return new Promise(resolve => {
          resolveB1 = resolve
        })
      }
      return Promise.resolve({ id: 'b2', name: 'Board 2', columns: [] })
    })

    const { result, rerender } = renderHook(({ id }) => useBoardData(id), {
      initialProps: { id: 'b1' },
    })

    await waitFor(() => {
      expect(mockGetBoard).toHaveBeenCalledWith('b1')
    })

    let joinerSettled = false
    act(() => {
      result.current.refresh().then(() => {
        joinerSettled = true
      })
    })

    rerender({ id: 'b2' })

    // b2 resolves immediately, so both outcomes are checkable: the orphaned joiner must not still
    // be waiting, and the leftover pending flag must not have triggered a second fetch.
    await waitFor(() => {
      expect(result.current.board).toEqual({ id: 'b2', name: 'Board 2', columns: [] })
    })

    expect(joinerSettled).toBe(true)
    expect(mockGetBoard).toHaveBeenCalledTimes(2)

    // b1's late, ownership-less settle must not add a third call either.
    await act(async () => {
      resolveB1({ id: 'b1', name: 'Sprint', columns: [] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockGetBoard).toHaveBeenCalledTimes(2)
  })
})
