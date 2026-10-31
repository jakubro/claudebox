/** Tests for useInlineReplySizes - per-reply box sizes held in the session's UI state. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUiState, patchSessionUiState } from '../../../../../api/uiState'
import useInlineReplySizes from './useInlineReplySizes'

vi.mock('../../../../../api/uiState', () => ({
  getUiState: vi.fn(),
  patchSessionUiState: vi.fn(),
}))

describe('useInlineReplySizes', () => {
  beforeEach(() => {
    vi.mocked(getUiState).mockReset()
    vi.mocked(patchSessionUiState).mockReset()
  })

  it('restores the sizes stored for the session', async () => {
    vi.mocked(getUiState).mockResolvedValue({
      session: { inlineReplySizes: { r1: { width: 700, height: 200 } } },
    })

    const { result } = renderHook(() => useInlineReplySizes('s1'))

    await waitFor(() => expect(result.current.sizes.get('r1')).toEqual({ width: 700, height: 200 }))
    expect(getUiState).toHaveBeenCalledWith('s1')
  })

  it('saves a size only when the drag is committed', async () => {
    vi.mocked(getUiState).mockResolvedValue({ session: {} })
    const { result } = renderHook(() => useInlineReplySizes('s1'))

    act(() => {
      result.current.resize('r1', { width: 600, height: 120 })
      result.current.resize('r1', { width: 650, height: 150 })
    })
    expect(patchSessionUiState).not.toHaveBeenCalled()

    act(() => result.current.commit('r1'))

    expect(patchSessionUiState).toHaveBeenCalledWith('s1', [
      { op: 'set', path: 'inlineReplySizes.r1', value: { width: 650, height: 150 } },
    ])
  })

  it('forgetting a sized reply drops it and unsets it in the session', async () => {
    vi.mocked(getUiState).mockResolvedValue({ session: {} })
    const { result } = renderHook(() => useInlineReplySizes('s1'))

    act(() => result.current.resize('r1', { width: 600, height: 120 }))
    act(() => result.current.forget('r1'))

    expect(result.current.sizes.has('r1')).toBe(false)
    expect(patchSessionUiState).toHaveBeenCalledWith('s1', [
      { op: 'unset', path: 'inlineReplySizes.r1' },
    ])
  })

  it('forgetting a reply that was never resized saves nothing', () => {
    vi.mocked(getUiState).mockResolvedValue({ session: {} })
    const { result } = renderHook(() => useInlineReplySizes('s1'))

    act(() => result.current.forget('r1'))

    expect(patchSessionUiState).not.toHaveBeenCalled()
  })

  it('a resize made before the stored sizes arrive is not overwritten by them', async () => {
    let resolveStored
    vi.mocked(getUiState).mockReturnValue(
      new Promise(resolve => {
        resolveStored = resolve
      }),
    )
    const { result } = renderHook(() => useInlineReplySizes('s1'))

    act(() => result.current.resize('r1', { width: 800, height: 300 }))
    await act(async () => {
      resolveStored({ session: { inlineReplySizes: { r1: { width: 400, height: 100 } } } })
    })

    expect(result.current.sizes.get('r1')).toEqual({ width: 800, height: 300 })
  })
})
