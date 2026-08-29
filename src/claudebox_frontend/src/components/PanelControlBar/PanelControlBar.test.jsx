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

  describe('split mode', () => {
    it('renders exactly one panel-control-bar element when splitRatio is given', () => {
      const { container } = render(
        <PanelControlBar splitRatio={0.5} rightContent={<span>right</span>}>
          <span>left</span>
        </PanelControlBar>,
      )

      expect(container.querySelectorAll('.panel-control-bar')).toHaveLength(1)
    })

    it('puts children in the left half and rightContent in the right half', () => {
      render(
        <PanelControlBar splitRatio={0.5} rightContent={<span data-testid="right-marker" />}>
          <span data-testid="left-marker" />
        </PanelControlBar>,
      )

      expect(
        screen.getByTestId('left-marker').closest('.panel-control-bar-left'),
      ).toBeInTheDocument()
      expect(
        screen.getByTestId('right-marker').closest('.panel-control-bar-right'),
      ).toBeInTheDocument()
    })

    it('sets the left half flex-basis from splitRatio', () => {
      const { container } = render(
        <PanelControlBar splitRatio={0.3} rightContent={<span>right</span>}>
          <span>left</span>
        </PanelControlBar>,
      )

      const left = container.querySelector('.panel-control-bar-left')
      // jsdom normalizes the inline style string, trimming the trailing zeros the component writes.
      expect(left.style.flexBasis).toBe('30%')
    })

    it('omits the halves when splitRatio is not given', () => {
      const { container } = render(<PanelControlBar>x</PanelControlBar>)

      expect(container.querySelector('.panel-control-bar-left')).toBeNull()
      expect(container.querySelector('.panel-control-bar-right')).toBeNull()
    })
  })
})
