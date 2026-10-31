/** Tests for StashContext. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SWITCH } from '../test-utils/sessionSequences'
import { createDeferred } from '../utils/deferred'
import { StashProvider, useStash } from './StashContext'

const mockGetUiState = vi.fn()
const mockPatchSessionUiState = vi.fn()

vi.mock('../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchSessionUiState: (...args) => mockPatchSessionUiState(...args),
}))

let mockSessionId = 'test-session-123'
vi.mock('./SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: mockSessionId }),
}))

describe('useStash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionId = 'test-session-123'
    mockGetUiState.mockResolvedValue({ session: { stash: [] } })
  })

  const wrapper = ({ children }) => <StashProvider>{children}</StashProvider>

  async function renderLoadedStash() {
    const hook = renderHook(() => useStash(), { wrapper })
    await waitFor(() => {
      expect(mockGetUiState).toHaveBeenCalled()
    })

    return hook
  }

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
    const { result } = await renderLoadedStash()

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

    expect(result.current.stash).toHaveLength(2)
    expect(result.current.stash[0].text).toBe('second item')
    expect(result.current.stash[1].text).toBe('first item')
  })

  it('stashPop() removes first item and sets pendingInsert', async () => {
    const { result } = await renderLoadedStash()

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
    const { result } = await renderLoadedStash()

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
    const { result } = await renderLoadedStash()

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
    const { result } = await renderLoadedStash()

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
    const { result } = await renderLoadedStash()

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
    const { result } = await renderLoadedStash()

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

    const { result } = await renderLoadedStash()

    // Should default to empty stash on error
    expect(result.current.stash).toEqual([])
  })
})

describe('useStash across a session switch', () => {
  const wrapper = ({ children }) => <StashProvider>{children}</StashProvider>
  let reads

  beforeEach(() => {
    vi.clearAllMocks()
    reads = { A: createDeferred(), B: createDeferred() }
    mockGetUiState.mockImplementation(id => reads[id].promise)
  })

  function switchToB() {
    const hook = renderHook(() => useStash(), { wrapper })
    for (const id of SWITCH.slice(1)) {
      mockSessionId = id
      hook.rerender()
    }

    return hook
  }

  const lastSave = () => mockPatchSessionUiState.mock.calls.at(-1)

  it('ignores a late reply for the session left', async () => {
    mockSessionId = 'A'
    const { result } = switchToB()

    await act(async () => {
      reads.B.resolve({ session: { stash: [{ text: 'b-item', timestamp: 2 }] } })
    })
    await act(async () => {
      reads.A.resolve({ session: { stash: [{ text: 'a-secret', timestamp: 1 }] } })
    })

    expect(result.current.stash.map(i => i.text)).toEqual(['b-item'])
    act(() => {
      result.current.stashPush('new in B')
    })
    expect(lastSave()[0]).toBe('B')
    expect(lastSave()[1][0].value.map(i => i.text)).toEqual(['new in B', 'b-item'])
  })

  it('keeps the stash when a late read for the session left fails', async () => {
    mockSessionId = 'A'
    const { result } = switchToB()
    await act(async () => {
      reads.B.resolve({ session: { stash: [{ text: 'b-item', timestamp: 2 }] } })
    })

    await act(async () => {
      reads.A.reject(new Error('timeout'))
    })

    expect(result.current.stash.map(i => i.text)).toEqual(['b-item'])
  })

  it.each([
    ['before the save', [{ text: 'b-item', timestamp: 2 }]],
    ['after the save', null],
  ])(
    'keeps an item stashed before the load above the stored ones (read served %s)',
    async (_label, stored) => {
      mockSessionId = 'B'
      const { result } = renderHook(() => useStash(), { wrapper })
      act(() => {
        result.current.stashPush('early')
      })
      const early = result.current.stash[0]

      await act(async () => {
        reads.B.resolve({ session: { stash: stored ?? [early, { text: 'b-item', timestamp: 2 }] } })
      })

      expect(result.current.stash.map(i => i.text)).toEqual(['early', 'b-item'])
      expect(lastSave()[1][0].value.map(i => i.text)).toEqual(['early', 'b-item'])
    },
  )
})
