/** Tests for StashContext. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StashProvider, useStash } from './StashContext'

// Mock API module
const mockGetUiState = vi.fn()
const mockPatchSessionUiState = vi.fn()

vi.mock('../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchSessionUiState: (...args) => mockPatchSessionUiState(...args),
}))

// Mock SessionDataContext
vi.mock('./SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: 'test-session-123' }),
}))

describe('useStash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUiState.mockResolvedValue({ session: { stash: [] } })
  })

  const wrapper = ({ children }) => <StashProvider>{children}</StashProvider>

  it('loads stash from server on mount', async () => {
    mockGetUiState.mockResolvedValue({
      session: { stash: [{ text: 'preloaded', timestamp: 123 }] },
    })

    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(result.current.stash).toHaveLength(1)
    })
    expect(result.current.stash[0].text).toBe('preloaded')
    expect(mockGetUiState).toHaveBeenCalledWith('test-session-123')
  })

  it('stashPush() adds item to front of stash and persists', async () => {
    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    act(() => {
      result.current.stashPush('first item')
    })

    expect(result.current.stash).toHaveLength(1)
    expect(result.current.stash[0].text).toBe('first item')
    expect(mockPatchSessionUiState).toHaveBeenCalledWith('test-session-123', [
      {
        op: 'set',
        path: 'stash',
        value: expect.arrayContaining([expect.objectContaining({ text: 'first item' })]),
      },
    ])

    act(() => {
      result.current.stashPush('second item')
    })

    // Second item should be at front
    expect(result.current.stash).toHaveLength(2)
    expect(result.current.stash[0].text).toBe('second item')
    expect(result.current.stash[1].text).toBe('first item')
  })

  it('stashPop() removes first item and sets pendingInsert', async () => {
    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    act(() => {
      result.current.stashPush('item to pop')
    })

    mockPatchSessionUiState.mockClear()

    let popped
    act(() => {
      popped = result.current.stashPop()
    })

    expect(popped).toBe('item to pop')
    expect(result.current.stash).toHaveLength(0)
    expect(result.current.pendingInsert).toBe('item to pop')
    expect(mockPatchSessionUiState).toHaveBeenCalledWith('test-session-123', [
      { op: 'set', path: 'stash', value: [] },
    ])
  })

  it('stashCopy() sets pendingInsert without removing', async () => {
    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    act(() => {
      result.current.stashPush('first')
    })
    act(() => {
      result.current.stashPush('second')
    })

    mockPatchSessionUiState.mockClear()

    act(() => {
      result.current.stashCopy(1) // Copy "first" (index 1 after push order)
    })

    expect(result.current.stash).toHaveLength(2) // Still has both
    expect(result.current.pendingInsert).toBe('first')
    // stashCopy does not persist (read-only operation)
    expect(mockPatchSessionUiState).not.toHaveBeenCalled()
  })

  it('stashRemove() removes item by index and persists', async () => {
    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    act(() => {
      result.current.stashPush('first')
    })
    act(() => {
      result.current.stashPush('second')
    })
    act(() => {
      result.current.stashPush('third')
    })

    mockPatchSessionUiState.mockClear()

    act(() => {
      result.current.stashRemove(1) // Remove middle item ("second")
    })

    expect(result.current.stash).toHaveLength(2)
    expect(result.current.stash.map(s => s.text)).toEqual(['third', 'first'])
    expect(result.current.pendingInsert).toBe('second')
    expect(mockPatchSessionUiState).toHaveBeenCalled()
  })

  it('clearPendingInsert() clears pendingInsert', async () => {
    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    act(() => {
      result.current.stashPush('item')
    })
    act(() => {
      result.current.stashPop()
    })

    expect(result.current.pendingInsert).toBe('item')

    act(() => {
      result.current.clearPendingInsert()
    })

    expect(result.current.pendingInsert).toBeNull()
  })

  it('rejects empty/whitespace text', async () => {
    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    mockPatchSessionUiState.mockClear()

    act(() => {
      result.current.stashPush('')
      result.current.stashPush('   ')
      result.current.stashPush(null)
    })

    expect(result.current.stash).toHaveLength(0)
    expect(mockPatchSessionUiState).not.toHaveBeenCalled()
  })

  it('clearStash() empties local stash without persisting (used for session switch)', async () => {
    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    act(() => {
      result.current.stashPush('item')
    })

    mockPatchSessionUiState.mockClear()

    act(() => {
      result.current.clearStash()
    })

    expect(result.current.stash).toHaveLength(0)
    // Should NOT persist - clearStash is for local state reset during session switch
    expect(mockPatchSessionUiState).not.toHaveBeenCalled()
  })

  it('handles server error gracefully', async () => {
    mockGetUiState.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useStash(), { wrapper })

    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    // Should default to empty stash on error
    expect(result.current.stash).toEqual([])
  })
})
