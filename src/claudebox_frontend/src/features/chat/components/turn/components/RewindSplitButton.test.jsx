/** Tests for RewindSplitButton component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import RewindSplitButton from './RewindSplitButton'

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span>▼</span>,
  Loader2: () => <span data-testid="spinner">...</span>,
  RotateCcw: () => <span data-testid="rewind-icon">↩</span>,
}))

vi.mock('../../../../../hooks/useDropdown', () => ({
  default: () => ({
    isOpen: false,
    setIsOpen: vi.fn(),
    containerRef: { current: null },
    handleToggle: vi.fn(),
    handleKeyDown: vi.fn(),
  }),
}))

vi.mock('../../../../../hooks/useCapabilities', () => ({
  default: () => ({ capabilities: null, runtimeName: null }),
}))

describe('RewindSplitButton', () => {
  it('calls onRewind with fork-here on left-click', async () => {
    const user = userEvent.setup()
    const onRewind = vi.fn()

    render(<RewindSplitButton turnId="turn-1" onRewind={onRewind} />)

    await user.click(screen.getByTitle(/Rewind to before this message/))

    expect(onRewind).toHaveBeenCalledWith('turn-1', 'fork-here')
  })

  it('calls onRewind with fork-browser-tab on middle-click', () => {
    const onRewind = vi.fn()

    render(<RewindSplitButton turnId="turn-1" onRewind={onRewind} />)

    const btn = screen.getByTitle(/Rewind to before this message/)
    btn.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))

    expect(onRewind).toHaveBeenCalledWith('turn-1', 'fork-browser-tab')
  })

  it('calls onRewind with fork-browser-tab on Alt+Click', () => {
    const onRewind = vi.fn()

    render(<RewindSplitButton turnId="turn-1" onRewind={onRewind} />)

    const btn = screen.getByTitle(/Rewind to before this message/)
    btn.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }))

    expect(onRewind).toHaveBeenCalledWith('turn-1', 'fork-browser-tab')
  })

  it('does not trigger fork-browser-tab on right-click', () => {
    const onRewind = vi.fn()

    render(<RewindSplitButton turnId="turn-1" onRewind={onRewind} />)

    const btn = screen.getByTitle(/Rewind to before this message/)
    btn.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }))

    expect(onRewind).not.toHaveBeenCalled()
  })

  it('disables button when forking', () => {
    const onRewind = vi.fn()

    render(<RewindSplitButton turnId="turn-1" onRewind={onRewind} forking />)

    const btn = screen.getByTitle(/Rewind to before this message/)
    expect(btn).toBeDisabled()
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })
})
