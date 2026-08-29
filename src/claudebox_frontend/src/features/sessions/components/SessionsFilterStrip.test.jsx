/** Tests for SessionsFilterStrip - overflow chevrons, wheel translation, scroll-into-view. */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_FILTER_ORDER } from '../utils/sessionTree'
import SessionsFilterStrip from './SessionsFilterStrip'

// jsdom implements neither - both are exercised by this component.
Element.prototype.scrollIntoView = vi.fn()
Element.prototype.scrollBy = vi.fn()

/** Stub the strip's own scroll geometry - jsdom never computes real layout. scrollLeft stays
 * writable, since the wheel handler assigns to it directly. */
function setStripGeometry({ scrollLeft = 0, clientWidth = 300, scrollWidth = 300 }) {
  const strip = screen.getByTestId('sessions-tabs')
  Object.defineProperties(strip, {
    scrollLeft: { value: scrollLeft, configurable: true, writable: true },
    clientWidth: { value: clientWidth, configurable: true },
    scrollWidth: { value: scrollWidth, configurable: true },
  })
  return strip
}

describe('SessionsFilterStrip', () => {
  const defaultProps = {
    activeFilter: SESSION_FILTER_ORDER[0],
    onSelectFilter: vi.fn(),
    getCount: () => 0,
  }

  beforeEach(() => {
    defaultProps.onSelectFilter.mockClear()
    Element.prototype.scrollIntoView.mockClear()
    Element.prototype.scrollBy.mockClear()
  })

  it('renders every filter in order', () => {
    render(<SessionsFilterStrip {...defaultProps} />)

    for (const filter of SESSION_FILTER_ORDER) {
      expect(screen.getByTestId(`sessions-filter-${filter}`)).toBeInTheDocument()
    }
  })

  it('shows no chevron when everything fits', () => {
    render(<SessionsFilterStrip {...defaultProps} />)
    fireEvent.scroll(setStripGeometry({ clientWidth: 300, scrollWidth: 300 }))

    expect(screen.queryByTitle('Scroll filters left')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Scroll filters right')).not.toBeInTheDocument()
  })

  it('shows only the right chevron when scrolled to the start with more beyond', () => {
    render(<SessionsFilterStrip {...defaultProps} />)
    fireEvent.scroll(setStripGeometry({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 }))

    expect(screen.queryByTitle('Scroll filters left')).not.toBeInTheDocument()
    expect(screen.getByTitle('Scroll filters right')).toBeInTheDocument()
  })

  it('shows only the left chevron once scrolled to the end', () => {
    render(<SessionsFilterStrip {...defaultProps} />)
    fireEvent.scroll(setStripGeometry({ scrollLeft: 200, clientWidth: 300, scrollWidth: 500 }))

    expect(screen.getByTitle('Scroll filters left')).toBeInTheDocument()
    expect(screen.queryByTitle('Scroll filters right')).not.toBeInTheDocument()
  })

  it('shows both chevrons when scrolled into the middle', () => {
    render(<SessionsFilterStrip {...defaultProps} />)
    fireEvent.scroll(setStripGeometry({ scrollLeft: 100, clientWidth: 300, scrollWidth: 500 }))

    expect(screen.getByTitle('Scroll filters left')).toBeInTheDocument()
    expect(screen.getByTitle('Scroll filters right')).toBeInTheDocument()
  })

  it('clicking the right chevron scrolls the strip forward, not backward', () => {
    render(<SessionsFilterStrip {...defaultProps} />)
    const strip = setStripGeometry({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 })
    fireEvent.scroll(strip)

    fireEvent.click(screen.getByTitle('Scroll filters right'))

    expect(strip.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number) }),
    )
    expect(strip.scrollBy.mock.calls[0][0].left).toBeGreaterThan(0)
  })

  it('clicking the left chevron scrolls the strip backward', () => {
    render(<SessionsFilterStrip {...defaultProps} />)
    const strip = setStripGeometry({ scrollLeft: 200, clientWidth: 300, scrollWidth: 500 })
    fireEvent.scroll(strip)

    fireEvent.click(screen.getByTitle('Scroll filters left'))

    expect(strip.scrollBy.mock.calls[0][0].left).toBeLessThan(0)
  })

  it('a wheel over the strip moves scrollLeft and suppresses the native scroll it would otherwise cause', () => {
    render(<SessionsFilterStrip {...defaultProps} />)
    const strip = setStripGeometry({ scrollLeft: 50, clientWidth: 300, scrollWidth: 500 })

    // The strip's own listener is native/non-passive (addEventListener), not React's onWheel -
    // dispatch a real wheel event to exercise it, matching what a native listener actually sees.
    const event = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true })
    strip.dispatchEvent(event)

    expect(strip.scrollLeft).toBe(90)
    expect(event.defaultPrevented).toBe(true)
  })

  it('scrolls the active filter into view when it changes, covering the auto-switch case', () => {
    const { rerender } = render(<SessionsFilterStrip {...defaultProps} />)

    rerender(<SessionsFilterStrip {...defaultProps} activeFilter={SESSION_FILTER_ORDER[2]} />)

    expect(
      screen.getByTestId(`sessions-filter-${SESSION_FILTER_ORDER[2]}`).scrollIntoView,
    ).toHaveBeenCalled()
  })

  it('clicking a filter calls onSelectFilter with that filter', () => {
    render(<SessionsFilterStrip {...defaultProps} />)

    fireEvent.click(screen.getByTestId(`sessions-filter-${SESSION_FILTER_ORDER[1]}`))

    expect(defaultProps.onSelectFilter).toHaveBeenCalledWith(SESSION_FILTER_ORDER[1])
  })
})
