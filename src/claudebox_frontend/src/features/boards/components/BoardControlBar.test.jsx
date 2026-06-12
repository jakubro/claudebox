/** Tests for BoardControlBar - density toggle backed by SessionRoutingContext. */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BoardControlBar from './BoardControlBar.jsx'

// Mock lucide-react icons - match the pattern used in ChatControlBar.test.jsx
vi.mock('lucide-react', () => ({
  List: () => <span data-testid="icon-list">List</span>,
  Rows3: () => <span data-testid="icon-rows3">Rows3</span>,
}))

// Mock SessionRoutingContext - only density + setDensity are consumed
let mockDensity = 'comfortable'
let mockSetDensity = vi.fn()
vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    density: mockDensity,
    setDensity: mockSetDensity,
  }),
}))

describe('BoardControlBar', () => {
  beforeEach(() => {
    mockDensity = 'comfortable'
    mockSetDensity = vi.fn()
  })

  it('wraps content in the shared PanelControlBar chrome', () => {
    const { container } = render(<BoardControlBar />)

    expect(container.querySelector('.panel-control-bar')).toBeInTheDocument()
    expect(container.querySelector('.panel-control-group')).toBeInTheDocument()
  })

  it('renders the density toggle with comfortable-state defaults', () => {
    mockDensity = 'comfortable'
    render(<BoardControlBar />)

    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('title', 'Switch to terse layout')
    expect(btn).toHaveClass('panel-control-btn')
    expect(btn).not.toHaveClass('pressed')
    // Comfortable density shows the Rows3 icon (terse target)
    expect(screen.getByTestId('icon-rows3')).toBeInTheDocument()
  })

  it('reflects terse state with pressed modifier and inverted target', () => {
    mockDensity = 'terse'
    render(<BoardControlBar />)

    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('title', 'Switch to comfortable layout')
    expect(btn).toHaveClass('panel-control-btn', 'pressed')
    // Terse density shows the List icon (comfortable target)
    expect(screen.getByTestId('icon-list')).toBeInTheDocument()
  })

  it('toggles comfortable -> terse on click', () => {
    mockDensity = 'comfortable'
    render(<BoardControlBar />)

    fireEvent.click(screen.getByRole('button'))

    expect(mockSetDensity).toHaveBeenCalledOnce()
    expect(mockSetDensity).toHaveBeenCalledWith('terse')
  })

  it('toggles terse -> comfortable on click', () => {
    mockDensity = 'terse'
    render(<BoardControlBar />)

    fireEvent.click(screen.getByRole('button'))

    expect(mockSetDensity).toHaveBeenCalledOnce()
    expect(mockSetDensity).toHaveBeenCalledWith('comfortable')
  })
})
