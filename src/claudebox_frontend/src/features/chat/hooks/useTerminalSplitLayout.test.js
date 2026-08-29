/** Tests for useTerminalSplitLayout - effective, width-aware right-slot visibility. */

import { render, renderHook, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RightSlotView } from '../utils/rightSlotViews'

let mockGetUiState = vi.fn()

vi.mock('../../../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchSessionUiState: vi.fn(),
}))

import { useTerminalSplitLayout } from './useTerminalSplitLayout'

describe('useTerminalSplitLayout', () => {
  beforeEach(() => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: {} })
  })

  it('shows the terminal view once hydrated with no measured width yet (assumes it fits)', async () => {
    mockGetUiState = vi
      .fn()
      .mockResolvedValue({ session: { rightSlotView: RightSlotView.TERMINAL } })
    const { result } = renderHook(() => useTerminalSplitLayout('session-1', false))

    await vi.waitFor(() => expect(result.current.terminalSplit).not.toBeNull())

    expect(result.current.activeView?.id).toBe(RightSlotView.TERMINAL)
  })

  it('shows the work view once hydrated with no measured width yet', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: { rightSlotView: RightSlotView.WORK } })
    const { result } = renderHook(() => useTerminalSplitLayout('session-1', false))

    await vi.waitFor(() => expect(result.current.terminalSplit).not.toBeNull())

    expect(result.current.activeView?.id).toBe(RightSlotView.WORK)
  })

  it('hides the slot on mobile even when enabled and wide enough', async () => {
    mockGetUiState = vi
      .fn()
      .mockResolvedValue({ session: { rightSlotView: RightSlotView.TERMINAL } })
    const { result } = renderHook(() => useTerminalSplitLayout('session-1', true))

    await vi.waitFor(() => expect(result.current.terminalSplit).not.toBeNull())

    expect(result.current.activeView).toBeNull()
  })

  it('hides the slot when the preference is off', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: { rightSlotView: RightSlotView.OFF } })
    const { result } = renderHook(() => useTerminalSplitLayout('session-1', false))

    await vi.waitFor(() => expect(result.current.terminalSplit).not.toBeNull())

    expect(result.current.activeView).toBeNull()
    // The raw preference stays visible for the control-bar picker's pressed state.
    expect(result.current.terminalSplit.view).toBe(RightSlotView.OFF)
  })

  it('hides the slot once a real (jsdom-zero-width) content area is measured', async () => {
    // Enabled explicitly - default-off would hide the split for an unrelated reason.
    mockGetUiState = vi
      .fn()
      .mockResolvedValue({ session: { rightSlotView: RightSlotView.TERMINAL } })
    // jsdom lays out nothing: clientWidth reads 0, always under the combined minimum, so a real
    // element proves the width-collapse path fires. createElement, not JSX - this file is .js.
    function Harness() {
      const { contentAreaRef, activeView } = useTerminalSplitLayout('session-1', false)
      return createElement('div', {
        ref: contentAreaRef,
        'data-testid': 'probe',
        'data-show': !!activeView,
      })
    }

    render(createElement(Harness))

    await vi.waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveAttribute('data-show', 'false'),
    )
  })
})
