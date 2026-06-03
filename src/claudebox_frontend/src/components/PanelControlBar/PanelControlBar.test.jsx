/** Tests for PanelControlBar component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PanelControlBar from './PanelControlBar.jsx'

describe('PanelControlBar', () => {
  it('renders a bar with the canonical panel-control-bar class', () => {
    const { container } = render(
      <PanelControlBar>
        <button type="button">child</button>
      </PanelControlBar>,
    )

    const bar = container.querySelector('.panel-control-bar')
    expect(bar).toBeInTheDocument()
    expect(bar.tagName).toBe('DIV')
  })

  it('renders children inside the bar', () => {
    render(
      <PanelControlBar>
        <span data-testid="child-marker">payload</span>
      </PanelControlBar>,
    )

    expect(screen.getByTestId('child-marker')).toBeInTheDocument()
  })

  it('appends custom className alongside the canonical class', () => {
    const { container } = render(<PanelControlBar className="extra-class">x</PanelControlBar>)

    const bar = container.querySelector('.panel-control-bar')
    expect(bar).toHaveClass('panel-control-bar', 'extra-class')
  })

  it('does not produce trailing whitespace when className is omitted', () => {
    const { container } = render(<PanelControlBar>x</PanelControlBar>)

    const bar = container.querySelector('.panel-control-bar')
    // className should be exactly 'panel-control-bar', no trailing space from default `${className}`.
    expect(bar.className).toBe('panel-control-bar')
  })
})
