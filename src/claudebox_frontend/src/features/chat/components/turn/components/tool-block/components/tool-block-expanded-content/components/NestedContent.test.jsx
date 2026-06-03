/** Tests for NestedContent component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NestedContent from './NestedContent'

describe('NestedContent', () => {
  it('renders children', () => {
    render(
      <NestedContent>
        <div data-testid="child">Child content</div>
      </NestedContent>,
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('applies nested-content class', () => {
    render(
      <NestedContent>
        <div>Content</div>
      </NestedContent>,
    )

    expect(document.querySelector('.nested-content')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(
      <NestedContent className="custom-class">
        <div>Content</div>
      </NestedContent>,
    )

    const wrapper = document.querySelector('.nested-content')
    expect(wrapper).toHaveClass('custom-class')
  })

  it('renders multiple children', () => {
    render(
      <NestedContent>
        <div data-testid="child1">First</div>
        <div data-testid="child2">Second</div>
      </NestedContent>,
    )

    expect(screen.getByTestId('child1')).toBeInTheDocument()
    expect(screen.getByTestId('child2')).toBeInTheDocument()
  })
})
