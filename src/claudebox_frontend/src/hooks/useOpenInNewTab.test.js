/** Tests for useOpenInNewTab. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NEW_TAB_FLASH_MS } from '../config/timing'
import useOpenInNewTab from './useOpenInNewTab'

let mockWorkspaceId = 'ws-1'
const mockOpen = vi.fn()

vi.mock('../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: mockWorkspaceId }),
}))
vi.mock('../utils/navigation', () => ({
  openSessionInNewTab: (...args) => mockOpen(...args),
}))

describe('useOpenInNewTab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceId = 'ws-1'
    mockOpen.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the session at the jump target and flashes the item until the flash ends', () => {
    const { result } = renderHook(() => useOpenInNewTab())

    act(() => result.current.openInNewTab('s2', 'row-1', { turnId: 't1' }))

    expect(mockOpen).toHaveBeenCalledWith('ws-1', 's2', { turnId: 't1' })
    expect(result.current.openingKey).toBe('row-1')
    act(() => vi.advanceTimersByTime(NEW_TAB_FLASH_MS))
    expect(result.current.openingKey).toBeNull()
  })

  it('does nothing without a workspace', () => {
    mockWorkspaceId = null
    const { result } = renderHook(() => useOpenInNewTab())

    act(() => result.current.openInNewTab('s2', 'row-1', {}))

    expect(mockOpen).not.toHaveBeenCalled()
    expect(result.current.openingKey).toBeNull()
  })

  it('clears its flash timer on unmount', () => {
    const { result, unmount } = renderHook(() => useOpenInNewTab())
    act(() => result.current.openInNewTab('s2', 'row-1', {}))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
