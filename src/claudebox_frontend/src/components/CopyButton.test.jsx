/** Tests for CopyButton component. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CopyButton from './CopyButton.jsx'

const mockWriteText = vi.fn().mockResolvedValue(undefined)

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockWriteText },
  writable: true,
  configurable: true,
})

describe('CopyButton', () => {
  beforeEach(() => {
    mockWriteText.mockClear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders with copy title by default', () => {
    render(<CopyButton text="hello" />)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'Copy')
  })

  it('renders with custom title', () => {
    render(<CopyButton text="hello" title="Copy code" />)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'Copy code')
  })

  it('applies custom className', () => {
    render(<CopyButton text="hello" className="extra-class" />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('copy-btn', 'extra-class')
  })

  it('copies text to clipboard on click', async () => {
    render(<CopyButton text="copy me" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    expect(mockWriteText).toHaveBeenCalledWith('copy me')
  })

  it('shows check icon after copying', async () => {
    render(<CopyButton text="copy me" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'Copied!')
  })

  it('reverts to copy icon after timeout', async () => {
    render(<CopyButton text="copy me" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Copied!')

    // Advance past the 2000ms timeout
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Copy')
  })
})
