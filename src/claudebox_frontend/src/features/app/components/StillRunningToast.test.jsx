/** Tests for StillRunningToast. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StillRunningToast from './StillRunningToast.jsx'

describe('StillRunningToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders previous session name in bold', () => {
    render(
      <StillRunningToast previousSessionName="My session" onReturn={vi.fn()} onDismiss={vi.fn()} />,
    )

    const toast = screen.getByTestId('still-running-toast')
    expect(toast).toHaveTextContent('Session My session still running')
  })

  it('calls onReturn when the toast is clicked', () => {
    const onReturn = vi.fn()

    render(<StillRunningToast previousSessionName="X" onReturn={onReturn} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByTestId('still-running-toast'))

    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after 5 seconds', () => {
    const onDismiss = vi.fn()

    render(<StillRunningToast previousSessionName="X" onReturn={vi.fn()} onDismiss={onDismiss} />)

    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('clears the dismiss timer on unmount', () => {
    const onDismiss = vi.fn()

    const { unmount } = render(
      <StillRunningToast previousSessionName="X" onReturn={vi.fn()} onDismiss={onDismiss} />,
    )

    unmount()

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })
})
