/** Tests for useBookmarks hook. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SWITCH } from '../test-utils/sessionSequences'
import { createDeferred } from '../utils/deferred'

let mockGetUiState = vi.fn()
let mockPatchGlobalUiState = vi.fn()

vi.mock('../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchGlobalUiState: (...args) => mockPatchGlobalUiState(...args),
}))

import useBookmarks from './useBookmarks'

async function renderEmptyBookmarks() {
  mockGetUiState.mockResolvedValue({ global: {} })
  const hook = renderHook(() => useBookmarks('session-1', 'ws-1'))
  await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

  return hook
}

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

  it('signals other tabs only after a toggle write lands', async () => {
    const write = createDeferred()
    mockPatchGlobalUiState.mockReturnValue(write.promise)
    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))
    await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

    act(() => {
      result.current.toggleBookmark('turn-1', 'user', 'Test')
    })
    await Promise.resolve()
    expect(localStorage.setItem).not.toHaveBeenCalled()

    await act(async () => write.resolve())
    expect(localStorage.setItem).toHaveBeenCalledTimes(1)
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'claudebox-bookmarks-changed',
      expect.any(String),
    )
  })

  it('writes and signals a toggle once under StrictMode', async () => {
    const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'), {
      reactStrictMode: true,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.toggleBookmark('turn-1', 'user', 'Test')
    })

    expect(mockPatchGlobalUiState).toHaveBeenCalledTimes(1)
    expect(localStorage.setItem).toHaveBeenCalledTimes(1)
    expect(result.current.allBookmarks['session-1']).toEqual(['turn-1:user'])
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
    const { result } = await renderEmptyBookmarks()

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
    const longPreview = 'A'.repeat(100)

    const { result } = await renderEmptyBookmarks()

    act(() => {
      result.current.toggleBookmark('turn-1', 'user', longPreview)
    })

    const call = mockPatchGlobalUiState.mock.calls[0][0]
    const setOp = call.find(op => op.op === 'set')
    expect(setOp.value.preview).toHaveLength(80)
  })

  describe('removeBookmark', () => {
    it('does nothing when targetSessionId, turnId, or messageType is missing', async () => {
      const { result } = await renderEmptyBookmarks()

      act(() => result.current.removeBookmark(null, 'turn-1', 'user'))
      act(() => result.current.removeBookmark('session-1', null, 'user'))
      act(() => result.current.removeBookmark('session-1', 'turn-1', null))

      expect(mockPatchGlobalUiState).not.toHaveBeenCalled()
    })

    it('removes a bookmark from a different session without touching current-session state', async () => {
      mockGetUiState.mockResolvedValue({
        global: {
          bookmarkedTurns: {
            'session-1': ['turn-a:user'],
            'session-2': ['turn-x:user', 'turn-y:assistant'],
          },
          bookmarkMeta: { 'session-2/turn-x:user': { preview: 'p', ts: '2026-01-01' } },
        },
      })

      const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))
      await waitFor(() => expect(result.current.bookmarkedMessageIds.size).toBe(1))

      act(() => {
        result.current.removeBookmark('session-2', 'turn-x', 'user')
      })

      expect(mockPatchGlobalUiState).toHaveBeenCalledWith([
        { op: 'remove', path: 'bookmarkedTurns.session-2', value: 'turn-x:user' },
        { op: 'unset', path: 'bookmarkMeta.session-2/turn-x:user' },
      ])
      expect(result.current.allBookmarks['session-2']).toEqual(['turn-y:assistant'])
      expect(result.current.bookmarkMeta['session-2/turn-x:user']).toBeUndefined()
      expect(result.current.bookmarkedMessageIds.has('turn-a:user')).toBe(true)
    })

    it('also clears the current session set when the target session matches', async () => {
      mockGetUiState.mockResolvedValue({
        global: { bookmarkedTurns: { 'session-1': ['turn-a:user'] } },
      })

      const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))
      await waitFor(() => expect(result.current.bookmarkedMessageIds.has('turn-a:user')).toBe(true))

      act(() => {
        result.current.removeBookmark('session-1', 'turn-a', 'user')
      })

      expect(result.current.bookmarkedMessageIds.has('turn-a:user')).toBe(false)
    })

    it('deletes the session key entirely once its last bookmark is removed', async () => {
      mockGetUiState.mockResolvedValue({
        global: { bookmarkedTurns: { 'session-2': ['turn-x:user'] } },
      })

      const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))
      await waitFor(() => expect(result.current.allBookmarks['session-2']).toEqual(['turn-x:user']))

      act(() => {
        result.current.removeBookmark('session-2', 'turn-x', 'user')
      })

      expect(result.current.allBookmarks['session-2']).toBeUndefined()
    })

    it('is a no-op on allBookmarks when the target session has no entries', async () => {
      const { result } = await renderEmptyBookmarks()

      act(() => {
        result.current.removeBookmark('session-3', 'turn-z', 'user')
      })

      expect(result.current.allBookmarks['session-3']).toBeUndefined()
      expect(mockPatchGlobalUiState).toHaveBeenCalled()
    })

    it('signals other tabs only after the write lands', async () => {
      mockGetUiState.mockResolvedValue({
        global: { bookmarkedTurns: { 'session-2': ['turn-x:user'] } },
      })
      const write = createDeferred()
      mockPatchGlobalUiState.mockReturnValue(write.promise)
      const { result } = renderHook(() => useBookmarks('session-1', 'ws-1'))
      await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

      act(() => {
        result.current.removeBookmark('session-2', 'turn-x', 'user')
      })
      await Promise.resolve()
      expect(localStorage.setItem).not.toHaveBeenCalled()

      await act(async () => write.resolve())
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'claudebox-bookmarks-changed',
        expect.any(String),
      )
    })
  })
})

describe('useBookmarks with reads answering out of order', () => {
  let reads

  beforeEach(() => {
    reads = []
    mockGetUiState = vi.fn(() => {
      const read = createDeferred()
      reads.push(read)

      return read.promise
    })
    mockPatchGlobalUiState = vi.fn()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  })

  const STORED = { global: { bookmarkedTurns: { A: ['a1:user'], B: ['t1:user'] } } }

  it("keeps the session's own bookmarks when the session left answers late", async () => {
    const { result, rerender } = renderHook(({ id }) => useBookmarks(id, 'ws-1'), {
      initialProps: { id: SWITCH[0] },
    })
    for (const id of SWITCH.slice(1)) {
      rerender({ id })
    }

    await act(async () => {
      reads.at(-1).resolve(STORED)
    })
    await act(async () => {
      reads[0].resolve(STORED)
    })

    expect(result.current.isBookmarked('t1', 'user')).toBe(true)
    act(() => {
      result.current.toggleBookmark('t1', 'user')
    })
    expect(mockPatchGlobalUiState.mock.calls[0][0][0].op).toBe('remove')
  })

  it('keeps a toggle made while a read is in flight', async () => {
    const { result } = renderHook(() => useBookmarks('B', 'ws-1'))
    act(() => {
      result.current.toggleBookmark('t2', 'user')
    })

    await act(async () => {
      reads[0].resolve({ global: {} })
    })

    expect(result.current.isBookmarked('t2', 'user')).toBe(true)
  })
})
