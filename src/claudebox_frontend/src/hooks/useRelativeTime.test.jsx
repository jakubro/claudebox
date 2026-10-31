/** Tests for useRelativeTime: one shared clock, a redraw only when a reader's own text changes. */

import { act, render, renderHook, screen } from '@testing-library/react'
import { memo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useRelativeTime from './useRelativeTime'

const NOW = Date.parse('2026-03-01T12:00:00Z')
const renders = vi.fn()

const Row = memo(function Row({ id, date }) {
  renders(id)
  return <span data-testid={id}>{useRelativeTime(date)}</span>
})

function rows() {
  return (
    <>
      <Row id="fresh" date={new Date(NOW - 40_000).toISOString()} />
      <Row id="hours" date={new Date(NOW - 3 * 3600_000).toISOString()} />
      <Row id="days" date={new Date(NOW - 3 * 86400_000).toISOString()} />
    </>
  )
}

describe('useRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    renders.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a tick that changes no text redraws no row', () => {
    render(rows())
    renders.mockClear()

    act(() => vi.advanceTimersByTime(15_000))

    expect(renders).not.toHaveBeenCalled()
  })

  it('the tick taking a row past a minute redraws only that row', () => {
    render(rows())
    renders.mockClear()

    act(() => vi.advanceTimersByTime(30_000))

    expect(renders.mock.calls.map(([id]) => id)).toEqual(['fresh'])
    expect(screen.getByTestId('fresh')).toHaveTextContent('1m ago')
  })

  it('one interval serves every row and none runs after the last unmounts', () => {
    const { unmount } = render(rows())

    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a tab becoming visible reads the clock at once', () => {
    render(rows())
    vi.setSystemTime(NOW + 10 * 60_000)

    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(screen.getByTestId('fresh')).toHaveTextContent('10m ago')
  })

  it('an empty date yields null', () => {
    const { result } = renderHook(() => useRelativeTime(null))

    expect(result.current).toBeNull()
  })
})
