/** Tests for useTerminalSplitLayout - effective, width-aware terminal-split visibility. */

import { render, renderHook, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('shows the split once hydrated with no measured width yet (assumes it fits)', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: { terminalSplitEnabled: true } })
    const { result } = renderHook(() => useTerminalSplitLayout('session-1', false))

    await vi.waitFor(() => expect(result.current.terminalSplit).not.toBeNull())

    expect(result.current.showTerminalSplit).toBe(true)
  })

  it('hides the split on mobile even when enabled and wide enough', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: { terminalSplitEnabled: true } })
    const { result } = renderHook(() => useTerminalSplitLayout('session-1', true))

    await vi.waitFor(() => expect(result.current.terminalSplit).not.toBeNull())

    expect(result.current.showTerminalSplit).toBe(false)
  })

  it('hides the split when the preference is disabled', async () => {
    mockGetUiState = vi.fn().mockResolvedValue({ session: { terminalSplitEnabled: false } })
    const { result } = renderHook(() => useTerminalSplitLayout('session-1', false))

    await vi.waitFor(() => expect(result.current.terminalSplit).not.toBeNull())

    expect(result.current.showTerminalSplit).toBe(false)
    // The raw preference stays visible for the control-bar toggle's pressed state.
    expect(result.current.terminalSplit.enabled).toBe(false)
  })

  it('hides the split once a real (jsdom-zero-width) content area is measured', async () => {
    // Enabled explicitly - default-off would hide the split for an unrelated reason.
    mockGetUiState = vi.fn().mockResolvedValue({ session: { terminalSplitEnabled: true } })
    // jsdom lays out nothing: clientWidth reads 0, always under the combined minimum, so a real
    // element proves the width-collapse path fires. createElement, not JSX - this file is .js.
    function Harness() {
      const { contentAreaRef, showTerminalSplit } = useTerminalSplitLayout('session-1', false)
      return createElement('div', {
        ref: contentAreaRef,
        'data-testid': 'probe',
        'data-show': showTerminalSplit,
      })
    }

    render(createElement(Harness))

    await vi.waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveAttribute('data-show', 'false'),
    )
  })
})
