/** Tests for useBookmarks hook. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockGetUiState = vi.fn()
let mockPatchGlobalUiState = vi.fn()

vi.mock('../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchGlobalUiState: (...args) => mockPatchGlobalUiState(...args),
}))

import useBookmarks from './useBookmarks'

describe('useBookmarks', () => {
  beforeEach(() => {
    mockGetUiState = vi.fn().mockResolvedValue({ global: {} })
    mockPatchGlobalUiState = vi.fn()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  })

  it('returns empty set when no bookmarks exist', async () => {
    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.bookmarkedMessageIds.size).toBe(0)
    })
  })

  it('loads bookmarks from ui-state on mount', async () => {
    mockGetUiState.mockResolvedValue({
      global: {
        bookmarkedTurns: { 'session-1': ['turn-a:user', 'turn-b:assistant'] },
        bookmarkMeta: {
          'session-1/turn-a:user': { preview: 'Hello', ts: '2026-01-01T00:00:00Z' },
          'session-1/turn-b:assistant': { preview: 'World', ts: '2026-01-01T00:01:00Z' },
        },
      },
    })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.bookmarkedMessageIds.size).toBe(2)
      expect(result.current.bookmarkedMessageIds.has('turn-a:user')).toBe(true)
      expect(result.current.bookmarkedMessageIds.has('turn-b:assistant')).toBe(true)
    })
  })

  it('only loads bookmarks for current session', async () => {
    mockGetUiState.mockResolvedValue({
      global: {
        bookmarkedTurns: {
          'session-1': ['turn-a:user'],
          'session-2': ['turn-x:user'],
        },
      },
    })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.bookmarkedMessageIds.size).toBe(1)
      expect(result.current.bookmarkedMessageIds.has('turn-a:user')).toBe(true)
    })
  })

  it('exposes allBookmarks across sessions', async () => {
    mockGetUiState.mockResolvedValue({
      global: {
        bookmarkedTurns: {
          'session-1': ['turn-a:user'],
          'session-2': ['turn-x:assistant'],
        },
      },
    })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(Object.keys(result.current.allBookmarks)).toEqual(['session-1', 'session-2'])
    })
  })

  it('isBookmarked checks specific message type', async () => {
    mockGetUiState.mockResolvedValue({
      global: {
        bookmarkedTurns: { 'session-1': ['turn-a:user', 'turn-a:assistant'] },
      },
    })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.isBookmarked('turn-a', 'user')).toBe(true)
      expect(result.current.isBookmarked('turn-a', 'assistant')).toBe(true)
      expect(result.current.isBookmarked('turn-b', 'user')).toBe(false)
    })
  })

  it('isTurnBookmarked returns true if any message in turn is bookmarked', async () => {
    mockGetUiState.mockResolvedValue({
      global: {
        bookmarkedTurns: { 'session-1': ['turn-a:assistant'] },
      },
    })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.isTurnBookmarked('turn-a')).toBe(true)
      expect(result.current.isTurnBookmarked('turn-b')).toBe(false)
    })
  })

  it('toggleBookmark adds a new bookmark', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.bookmarkedMessageIds.size).toBe(0)
    })

    act(() => {
      result.current.toggleBookmark('turn-new', 'user', 'Preview text')
    })

    expect(result.current.bookmarkedMessageIds.has('turn-new:user')).toBe(true)
    expect(mockPatchGlobalUiState).toHaveBeenCalledWith([
      { op: 'add', path: 'bookmarkedTurns.session-1', value: 'turn-new:user' },
      {
        op: 'set',
        path: 'bookmarkMeta.session-1/turn-new:user',
        value: expect.objectContaining({ preview: 'Preview text' }),
      },
    ])
  })

  it('toggleBookmark removes an existing bookmark', async () => {
    mockGetUiState.mockResolvedValue({
      global: {
        bookmarkedTurns: { 'session-1': ['turn-a:user'] },
        bookmarkMeta: { 'session-1/turn-a:user': { preview: 'Hi', ts: '2026-01-01' } },
      },
    })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.bookmarkedMessageIds.has('turn-a:user')).toBe(true)
    })

    act(() => {
      result.current.toggleBookmark('turn-a', 'user')
    })

    expect(result.current.bookmarkedMessageIds.has('turn-a:user')).toBe(false)
    expect(mockPatchGlobalUiState).toHaveBeenCalledWith([
      { op: 'remove', path: 'bookmarkedTurns.session-1', value: 'turn-a:user' },
      { op: 'unset', path: 'bookmarkMeta.session-1/turn-a:user' },
    ])
  })

  it('signals cross-tab via localStorage after toggle', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

    act(() => {
      result.current.toggleBookmark('turn-1', 'user', 'Test')
    })

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'claudebox-bookmarks-changed',
      expect.any(String),
    )
  })

  it('does nothing when sessionId is null', async () => {
    const { result } = renderHook(() => useBookmarks(null, 'ws-1'))

    await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

    act(() => {
      result.current.toggleBookmark('turn-1', 'user', 'Test')
    })

    expect(mockPatchGlobalUiState).not.toHaveBeenCalled()
  })

  it('does nothing when messageType is missing', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

    act(() => {
      result.current.toggleBookmark('turn-1')
    })

    expect(mockPatchGlobalUiState).not.toHaveBeenCalled()
  })

  it('initial loading is true synchronously, before fetch resolves', () => {
    let resolveFetch
    mockGetUiState = vi.fn().mockReturnValue(
      new Promise(r => {
        resolveFetch = r
      }),
    )

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    expect(result.current.loading).toBe(true)

    // Resolve to avoid leaking the pending promise into other tests.
    resolveFetch({ global: {} })
  })

  it('loading flips to false after first fetch resolves', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBeNull()
  })

  it('loading flips to false after first fetch rejects; error exposed', async () => {
    mockGetUiState = vi.fn().mockRejectedValue(new Error('Network down'))

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe('Network down')
  })

  it('loading stays true across pre-workspace gap, flips on first real fetch', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })

    const { result, rerender } = renderHook(({ wsId }) => useBookmarks('session-1', wsId), {
      initialProps: { wsId: null },
    })

    // Pre-workspace: hook returned early without fetching, loading still true.
    expect(result.current.loading).toBe(true)
    expect(mockGetUiState).not.toHaveBeenCalled()

    rerender({ wsId: 'ws-1' })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(mockGetUiState).toHaveBeenCalled()
  })

  it('cross-tab storage event refetch does not flip loading back', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'claudebox-bookmarks-changed', newValue: '1' }),
      )
    })

    expect(result.current.loading).toBe(false)
  })

  it('sessionId change post-hydration does not flip loading back', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })

    const { result, rerender } = renderHook(({ sid }) => useBookmarks(sid, 'ws-1'), {
      initialProps: { sid: 'session-1' },
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    rerender({ sid: 'session-2' })

    // Refetch may run, but loading stays false (sticky after first settle).
    expect(result.current.loading).toBe(false)
  })

  it('truncates preview to 80 characters', async () => {
    mockGetUiState.mockResolvedValue({ global: {} })
    const longPreview = 'A'.repeat(100)

    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))
    await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

    act(() => {
      result.current.toggleBookmark('turn-1', 'user', longPreview)
    })

    const call = mockPatchGlobalUiState.mock.calls[0][0]
    const setOp = call.find(op => op.op === 'set')
    expect(setOp.value.preview).toHaveLength(80)
  })
})
