/** Tests for ActiveStatus component. */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActiveStatus from './ActiveStatus'

describe('ActiveStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders label with animated dots and interrupt hint', () => {
    const now = Date.now()
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={now}
        lastEventTimestamp={now}
      />,
    )

    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+. to stop')).toBeInTheDocument()
    expect(screen.getByTestId('footer-status')).toHaveAttribute('data-status', 'working')
  })

  it('shows elapsed timer after 1 second', () => {
    const now = Date.now()
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={now}
        lastEventTimestamp={now}
      />,
    )

    expect(screen.queryByText(/\(\d+s\)/)).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1000))

    expect(screen.getByText('(1s)')).toBeInTheDocument()
  })

  it('anchors elapsed timer to respondingSince, not mount time', () => {
    const threeSecondsAgo = Date.now() - 3000
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={threeSecondsAgo}
        lastEventTimestamp={Date.now()}
      />,
    )

    // First tick should show ~3s since respondingSince is 3s in the past
    act(() => vi.advanceTimersByTime(1000))

    expect(screen.getByText('(4s)')).toBeInTheDocument()
  })

  it('formats minutes without seconds', () => {
    const twoMinutesAgo = Date.now() - 120_000
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={twoMinutesAgo}
        lastEventTimestamp={Date.now()}
      />,
    )

    act(() => vi.advanceTimersByTime(1000))

    expect(screen.getByText('(2m)')).toBeInTheDocument()
  })

  it('formats hours with minutes', () => {
    const ninetyMinutesAgo = Date.now() - 90 * 60_000
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={ninetyMinutesAgo}
        lastEventTimestamp={Date.now()}
      />,
    )

    act(() => vi.advanceTimersByTime(1000))

    expect(screen.getByText('(1h 30m)')).toBeInTheDocument()
  })

  it('formats days with hours', () => {
    const thirtyHoursAgo = Date.now() - 30 * 3600_000
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={thirtyHoursAgo}
        lastEventTimestamp={Date.now()}
      />,
    )

    act(() => vi.advanceTimersByTime(1000))

    expect(screen.getByText('(1d 6h)')).toBeInTheDocument()
  })

  it('keeps the Working label at full strength through silence', () => {
    const now = Date.now()
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={now}
        lastEventTimestamp={now}
      />,
    )

    // Advance past silence threshold (5s)
    act(() => vi.advanceTimersByTime(6000))

    expect(screen.getByText('Working')).not.toHaveClass('status-silent')
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
  })

  it('applies status-silent class when silent', () => {
    const now = Date.now()
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={now}
        lastEventTimestamp={now}
      />,
    )

    const dot = screen.getByTestId('footer-status')
    expect(dot).not.toHaveClass('status-silent')

    act(() => vi.advanceTimersByTime(6000))

    expect(dot).toHaveClass('status-silent')
  })

  it('reverts the dot to active when new events arrive', () => {
    const now = Date.now()
    const { rerender } = render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={now}
        lastEventTimestamp={now}
      />,
    )

    const dot = screen.getByTestId('footer-status')
    act(() => vi.advanceTimersByTime(6000))
    expect(dot).toHaveClass('status-silent')

    rerender(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={now}
        lastEventTimestamp={Date.now()}
      />,
    )

    expect(dot).not.toHaveClass('status-silent')
    expect(screen.getByText('Working')).toBeInTheDocument()
  })

  it('does not show silent state without lastEventTimestamp', () => {
    render(
      <ActiveStatus
        label="Submitting"
        status="submitting"
        respondingSince={null}
        lastEventTimestamp={null}
      />,
    )

    act(() => vi.advanceTimersByTime(10000))

    expect(screen.getByText('Submitting')).toBeInTheDocument()
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
  })

  it('increments elapsed time continuously', () => {
    const now = Date.now()
    render(
      <ActiveStatus
        label="Working"
        status="working"
        respondingSince={now}
        lastEventTimestamp={now}
      />,
    )

    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('(3s)')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText('(5s)')).toBeInTheDocument()
  })

  it('falls back to mount time when respondingSince is null', () => {
    render(
      <ActiveStatus
        label="Submitting"
        status="submitting"
        respondingSince={null}
        lastEventTimestamp={null}
      />,
    )

    act(() => vi.advanceTimersByTime(2000))

    expect(screen.getByText('(2s)')).toBeInTheDocument()
  })
})
