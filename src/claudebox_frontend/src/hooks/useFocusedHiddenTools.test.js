/** Tests for useFocusedHiddenTools - the workspace's tools hidden from Focused by hand. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../utils/deferred'

let mockGetUiState = vi.fn()
let mockPatchGlobalUiState = vi.fn()

vi.mock('../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchGlobalUiState: (...args) => mockPatchGlobalUiState(...args),
}))

import useFocusedHiddenTools from './useFocusedHiddenTools'

describe('useFocusedHiddenTools', () => {
  beforeEach(() => {
    mockGetUiState = vi.fn().mockResolvedValue({ global: {} })
    mockPatchGlobalUiState = vi.fn()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  })

  it("hydrates the workspace's marks", async () => {
    mockGetUiState.mockResolvedValue({ global: { focusedHiddenTools: ['mcp__jina__read_url'] } })
    const { result } = renderHook(() => useFocusedHiddenTools('ws-1'))

    await waitFor(() => expect(result.current.hiddenTools.has('mcp__jina__read_url')).toBe(true))
  })

  it('reads nothing without a workspace', () => {
    const { result } = renderHook(() => useFocusedHiddenTools(null))

    expect(result.current.hiddenTools.size).toBe(0)
    expect(mockGetUiState).not.toHaveBeenCalled()
  })

  it('marks a tool optimistically, writes an add and signals other tabs once it lands', async () => {
    const { result } = renderHook(() => useFocusedHiddenTools('ws-1'))
    await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

    act(() => result.current.markTool('mcp__jina__read_url'))

    expect(result.current.hiddenTools.has('mcp__jina__read_url')).toBe(true)
    expect(mockPatchGlobalUiState).toHaveBeenCalledWith([
      { op: 'add', path: 'focusedHiddenTools', value: 'mcp__jina__read_url' },
    ])
    await waitFor(() =>
      expect(Storage.prototype.setItem).toHaveBeenCalledWith(
        'claudebox-focused-hidden-tools-changed',
        expect.any(String),
      ),
    )
  })

  it('unmarks every named mark in one write and ignores a name not marked', async () => {
    mockGetUiState.mockResolvedValue({
      global: { focusedHiddenTools: ['read_url', 'mcp__docs__read_url', 'primer'] },
    })
    const { result } = renderHook(() => useFocusedHiddenTools('ws-1'))
    await waitFor(() => expect(result.current.hiddenTools.size).toBe(3))

    act(() => result.current.unmarkTools(['read_url', 'mcp__docs__read_url', 'search_web']))

    expect([...result.current.hiddenTools]).toEqual(['primer'])
    expect(mockPatchGlobalUiState).toHaveBeenCalledWith([
      { op: 'remove', path: 'focusedHiddenTools', value: 'read_url' },
      { op: 'remove', path: 'focusedHiddenTools', value: 'mcp__docs__read_url' },
    ])
  })

  it('unmarks a marked tool with a remove', async () => {
    mockGetUiState.mockResolvedValue({ global: { focusedHiddenTools: ['read_url'] } })
    const { result } = renderHook(() => useFocusedHiddenTools('ws-1'))
    await waitFor(() => expect(result.current.hiddenTools.has('read_url')).toBe(true))

    act(() => result.current.unmarkTools(['read_url']))

    expect(result.current.hiddenTools.has('read_url')).toBe(false)
    expect(mockPatchGlobalUiState).toHaveBeenCalledWith([
      { op: 'remove', path: 'focusedHiddenTools', value: 'read_url' },
    ])
  })

  it('drops a read a local toggle overtook', async () => {
    const read = createDeferred()
    mockGetUiState.mockReturnValue(read.promise)
    const { result } = renderHook(() => useFocusedHiddenTools('ws-1'))

    act(() => result.current.markTool('mcp__jina__read_url'))
    await act(async () => read.resolve({ global: { focusedHiddenTools: [] } }))

    expect(result.current.hiddenTools.has('mcp__jina__read_url')).toBe(true)
  })

  it("re-reads on another tab's signal", async () => {
    const { result } = renderHook(() => useFocusedHiddenTools('ws-1'))
    await waitFor(() => expect(mockGetUiState).toHaveBeenCalledTimes(1))
    mockGetUiState.mockResolvedValue({ global: { focusedHiddenTools: ['primer'] } })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'claudebox-focused-hidden-tools-changed' }),
      )
    })

    await waitFor(() => expect(result.current.hiddenTools.has('primer')).toBe(true))
  })

  it("starts empty in another workspace and reads that workspace's own marks", async () => {
    mockGetUiState.mockResolvedValueOnce({ global: { focusedHiddenTools: ['primer'] } })
    const { result, rerender } = renderHook(({ ws }) => useFocusedHiddenTools(ws), {
      initialProps: { ws: 'ws-1' },
    })
    await waitFor(() => expect(result.current.hiddenTools.has('primer')).toBe(true))
    const second = createDeferred()
    mockGetUiState.mockReturnValueOnce(second.promise)

    rerender({ ws: 'ws-2' })
    expect(result.current.hiddenTools.size).toBe(0)

    await act(async () => second.resolve({ global: { focusedHiddenTools: ['read_url'] } }))
    expect([...result.current.hiddenTools]).toEqual(['read_url'])
  })

  it('signals other tabs only after the write lands', async () => {
    const write = createDeferred()
    mockPatchGlobalUiState.mockReturnValue(write.promise)
    const { result } = renderHook(() => useFocusedHiddenTools('ws-1'))
    await waitFor(() => expect(mockGetUiState).toHaveBeenCalled())

    act(() => result.current.markTool('read_url'))
    await Promise.resolve()
    expect(Storage.prototype.setItem).not.toHaveBeenCalled()

    await act(async () => write.resolve())
    expect(Storage.prototype.setItem).toHaveBeenCalledTimes(1)
  })
})
