/** Tests for useTerminalSplit - terminal-split toggle + divider ratio, hydrated/persisted. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_SPLIT_DEFAULT_RATIO } from '../../../config/dimensions'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'

let mockGetUiState = vi.fn()
let mockPatchSessionUiState = vi.fn()

vi.mock('../../../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchSessionUiState: (...args) => mockPatchSessionUiState(...args),
}))

import { useTerminalSplit } from './useTerminalSplit'

describe('useTerminalSplit', () => {
  beforeEach(() => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: {} })
    mockPatchSessionUiState = vi.fn()
    vi.useFakeTimers()
  })

  it('is null (tri-state) before hydration resolves', () => {
    const { result } = renderHook(() => useTerminalSplit('session-1'))
    expect(result.current.split).toBeNull()
  })

  it('defaults to disabled at the default ratio when no session ui-state is stored', async () => {
    const { result } = renderHook(() => useTerminalSplit('session-1'))

    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    expect(result.current.split).toEqual({ enabled: false, ratio: CHAT_SPLIT_DEFAULT_RATIO })
  })

  it('hydrates the stored enabled/ratio values', async () => {
    mockGetUiState = vi
      .fn()
      .mockResolvedValue({ session: { terminalSplitEnabled: false, terminalSplitRatio: 0.35 } })
    const { result } = renderHook(() => useTerminalSplit('session-1'))

    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    expect(result.current.split).toEqual({ enabled: false, ratio: 0.35 })
  })

  it('stays null with no sessionId', () => {
    const { result } = renderHook(() => useTerminalSplit(null))
    expect(result.current.split).toBeNull()
    expect(mockGetUiState).not.toHaveBeenCalled()
  })

  it('falls back to disabled defaults when hydration fails', async () => {
    mockGetUiState = vi.fn().mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useTerminalSplit('session-1'))

    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    expect(result.current.split).toEqual({ enabled: false, ratio: CHAT_SPLIT_DEFAULT_RATIO })
  })

  it('toggleEnabled flips local state and persists', async () => {
    const { result } = renderHook(() => useTerminalSplit('session-1'))
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    act(() => {
      result.current.toggleEnabled()
    })

    expect(result.current.split.enabled).toBe(true)
    expect(mockPatchSessionUiState).toHaveBeenCalledWith('session-1', [
      { op: 'set', path: 'terminalSplitEnabled', value: true },
    ])
  })

  it('setRatio updates local state immediately but debounces the persist', async () => {
    const { result } = renderHook(() => useTerminalSplit('session-1'))
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    act(() => {
      result.current.setRatio(0.6)
    })

    expect(result.current.split.ratio).toBe(0.6)
    expect(mockPatchSessionUiState).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(LAYOUT_SAVE_DEBOUNCE_MS)
    })

    expect(mockPatchSessionUiState).toHaveBeenCalledWith('session-1', [
      { op: 'set', path: 'terminalSplitRatio', value: 0.6 },
    ])
  })

  it('setRatio coalesces rapid updates into a single debounced persist of the latest value', async () => {
    const { result } = renderHook(() => useTerminalSplit('session-1'))
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    act(() => {
      result.current.setRatio(0.4)
      vi.advanceTimersByTime(100)
      result.current.setRatio(0.45)
      vi.advanceTimersByTime(100)
      result.current.setRatio(0.5)
    })

    act(() => {
      vi.advanceTimersByTime(LAYOUT_SAVE_DEBOUNCE_MS)
    })

    expect(mockPatchSessionUiState).toHaveBeenCalledTimes(1)
    expect(mockPatchSessionUiState).toHaveBeenCalledWith('session-1', [
      { op: 'set', path: 'terminalSplitRatio', value: 0.5 },
    ])
  })

  it('resets to null and re-hydrates on session change', async () => {
    mockGetUiState = vi
      .fn()
      .mockResolvedValueOnce({ session: { terminalSplitEnabled: false } })
      .mockResolvedValueOnce({ session: {} })
    const { result, rerender } = renderHook(({ sessionId }) => useTerminalSplit(sessionId), {
      initialProps: { sessionId: 'session-1' },
    })
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())
    expect(result.current.split.enabled).toBe(false)

    rerender({ sessionId: 'session-2' })
    expect(result.current.split).toBeNull()

    await vi.waitFor(() => expect(result.current.split).not.toBeNull())
    expect(result.current.split).toEqual({ enabled: false, ratio: CHAT_SPLIT_DEFAULT_RATIO })
  })
})
