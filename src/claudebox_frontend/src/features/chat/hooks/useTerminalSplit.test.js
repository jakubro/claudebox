/** Tests for useTerminalSplit - right-slot view choice + divider ratio, hydrated/persisted. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_SPLIT_DEFAULT_RATIO } from '../../../config/dimensions'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'
import { BOUNCE, SWITCH } from '../../../test-utils/sessionSequences'
import { RightSlotView } from '../utils/rightSlotViews'

let mockGetUiState = vi.fn()
let mockPatchSessionUiState = vi.fn()

vi.mock('../../../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchSessionUiState: (...args) => mockPatchSessionUiState(...args),
}))

import { useTerminalSplit } from './useTerminalSplit'

async function renderHydrated() {
  const hook = renderHook(() => useTerminalSplit('session-1'))
  await vi.waitFor(() => expect(hook.result.current.split).not.toBeNull())

  return hook
}

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

  it('defaults to Focused at the default ratio when no session ui-state is stored', async () => {
    const { result } = await renderHydrated()

    expect(result.current.split).toEqual({
      view: RightSlotView.FOCUSED,
      ratio: CHAT_SPLIT_DEFAULT_RATIO,
    })
  })

  it('hydrates the stored view/ratio values', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({
      session: { rightSlotView: RightSlotView.WORK, terminalSplitRatio: 0.35 },
    })
    const { result } = await renderHydrated()

    expect(result.current.split).toEqual({ view: RightSlotView.WORK, ratio: 0.35 })
  })

  it('reads an older session stored true as terminal', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: { terminalSplitEnabled: true } })
    const { result } = await renderHydrated()

    expect(result.current.split.view).toBe(RightSlotView.TERMINAL)
  })

  it('reads an older session stored false as Everything', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: { terminalSplitEnabled: false } })
    const { result } = await renderHydrated()

    expect(result.current.split.view).toBe(RightSlotView.EVERYTHING)
  })

  it('prefers the newer rightSlotView key over an older stored boolean', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({
      session: { terminalSplitEnabled: true, rightSlotView: RightSlotView.WORK },
    })
    const { result } = await renderHydrated()

    expect(result.current.split.view).toBe(RightSlotView.WORK)
  })

  it('stays null with no sessionId', () => {
    const { result } = renderHook(() => useTerminalSplit(null))
    expect(result.current.split).toBeNull()
    expect(mockGetUiState).not.toHaveBeenCalled()
  })

  it('falls back to Focused defaults when hydration fails', async () => {
    mockGetUiState = vi.fn().mockRejectedValue(new Error('network'))
    const { result } = await renderHydrated()

    expect(result.current.split).toEqual({
      view: RightSlotView.FOCUSED,
      ratio: CHAT_SPLIT_DEFAULT_RATIO,
    })
  })

  it('setView selects the view locally and persists it', async () => {
    const { result } = await renderHydrated()

    act(() => {
      result.current.setView(RightSlotView.WORK)
    })

    expect(result.current.split.view).toBe(RightSlotView.WORK)
    expect(mockPatchSessionUiState).toHaveBeenCalledWith('session-1', [
      { op: 'set', path: 'rightSlotView', value: RightSlotView.WORK },
    ])
  })

  it('setView back to Focused selects it and persists it', async () => {
    mockGetUiState = vi
      .fn()
      .mockResolvedValue({ session: { rightSlotView: RightSlotView.TERMINAL } })
    const { result } = await renderHydrated()

    act(() => {
      result.current.setView(RightSlotView.FOCUSED)
    })

    expect(result.current.split.view).toBe(RightSlotView.FOCUSED)
    expect(mockPatchSessionUiState).toHaveBeenCalledWith('session-1', [
      { op: 'set', path: 'rightSlotView', value: RightSlotView.FOCUSED },
    ])
  })

  it('setRatio updates local state immediately but debounces the persist', async () => {
    const { result } = await renderHydrated()

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
    const { result } = await renderHydrated()

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
      .mockResolvedValueOnce({ session: { rightSlotView: RightSlotView.TERMINAL } })
      .mockResolvedValueOnce({ session: {} })
    const { result, rerender } = renderHook(({ sessionId }) => useTerminalSplit(sessionId), {
      initialProps: { sessionId: 'session-1' },
    })
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())
    expect(result.current.split.view).toBe(RightSlotView.TERMINAL)

    rerender({ sessionId: 'session-2' })
    expect(result.current.split).toBeNull()

    await vi.waitFor(() => expect(result.current.split).not.toBeNull())
    expect(result.current.split).toEqual({
      view: RightSlotView.FOCUSED,
      ratio: CHAT_SPLIT_DEFAULT_RATIO,
    })
  })

  it("SWITCH: the next session never shows the last one's view, and gets its own once read", async () => {
    const [a, empty, b] = SWITCH
    let answerB
    mockGetUiState = vi
      .fn()
      .mockResolvedValueOnce({ session: { rightSlotView: RightSlotView.EVERYTHING } })
      .mockReturnValueOnce(
        new Promise(resolve => {
          answerB = resolve
        }),
      )
    const { result, rerender } = renderHook(({ sessionId }) => useTerminalSplit(sessionId), {
      initialProps: { sessionId: a },
    })
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    rerender({ sessionId: empty })
    expect(result.current.split).toBeNull()
    rerender({ sessionId: b })
    expect(result.current.split).toBeNull()

    await act(async () => {
      answerB({ session: { rightSlotView: RightSlotView.TERMINAL, terminalSplitRatio: 0.3 } })
    })
    expect(result.current.split).toEqual({ view: RightSlotView.TERMINAL, ratio: 0.3 })
    expect(mockGetUiState.mock.calls).toEqual([[a], [b]])
  })

  it('BOUNCE: the session handed back keeps its view at once and is not read again', async () => {
    const [a, empty] = BOUNCE
    mockGetUiState = vi.fn().mockResolvedValue({
      session: { rightSlotView: RightSlotView.EVERYTHING, terminalSplitRatio: 0.4 },
    })
    const { result, rerender } = renderHook(({ sessionId }) => useTerminalSplit(sessionId), {
      initialProps: { sessionId: a },
    })
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())
    const read = result.current.split

    rerender({ sessionId: empty })
    rerender({ sessionId: a })

    expect(result.current.split).toBe(read)
    expect(read).toEqual({ view: RightSlotView.EVERYTHING, ratio: 0.4 })
    expect(mockGetUiState).toHaveBeenCalledTimes(1)
  })

  it('a session left before its read lands keeps the view it had, and the late read is dropped', async () => {
    let answerB
    mockGetUiState = vi
      .fn()
      .mockResolvedValueOnce({ session: { rightSlotView: RightSlotView.WORK } })
      .mockReturnValueOnce(
        new Promise(resolve => {
          answerB = resolve
        }),
      )
    const { result, rerender } = renderHook(({ sessionId }) => useTerminalSplit(sessionId), {
      initialProps: { sessionId: 'session-1' },
    })
    await vi.waitFor(() => expect(result.current.split).not.toBeNull())

    rerender({ sessionId: 'session-2' })
    rerender({ sessionId: 'session-1' })
    await act(async () => {
      answerB({ session: { rightSlotView: RightSlotView.TERMINAL } })
    })

    expect(result.current.split.view).toBe(RightSlotView.WORK)
  })

  it('a pick made before the view is read changes and persists nothing', () => {
    mockGetUiState = vi.fn().mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useTerminalSplit('session-1'))

    act(() => {
      result.current.setView(RightSlotView.WORK)
      result.current.setRatio(0.7)
    })
    act(() => {
      vi.advanceTimersByTime(LAYOUT_SAVE_DEBOUNCE_MS)
    })

    expect(result.current.split).toBeNull()
    expect(mockPatchSessionUiState).not.toHaveBeenCalled()
  })
})
