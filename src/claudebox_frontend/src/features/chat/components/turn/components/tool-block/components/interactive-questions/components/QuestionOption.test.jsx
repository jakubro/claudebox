/** Tests for QuestionOption. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import QuestionOption from './QuestionOption'

describe('QuestionOption', () => {
  const defaultProps = {
    label: 'Option A',
    isSelected: false,
    multiSelect: false,
    disabled: false,
    onClick: vi.fn(),
  }

  describe('indicator symbols', () => {
    it('shows empty radio indicator for unselected single-select', () => {
      render(<QuestionOption {...defaultProps} />)

      expect(screen.getByText('○')).toBeInTheDocument()
    })

    it('shows filled radio indicator for selected single-select', () => {
      render(<QuestionOption {...defaultProps} isSelected />)

      expect(screen.getByText('●')).toBeInTheDocument()
    })

    it('shows empty checkbox indicator for unselected multi-select', () => {
      render(<QuestionOption {...defaultProps} multiSelect />)

      expect(screen.getByText('☐')).toBeInTheDocument()
    })

    it('shows filled checkbox indicator for selected multi-select', () => {
      render(<QuestionOption {...defaultProps} multiSelect isSelected />)

      expect(screen.getByText('☑')).toBeInTheDocument()
    })
  })

  describe('content rendering', () => {
    it('renders the label text', () => {
      render(<QuestionOption {...defaultProps} />)

      expect(screen.getByText('Option A')).toBeInTheDocument()
    })

    it('renders description when provided', () => {
      render(<QuestionOption {...defaultProps} description="Some detail" />)

      expect(screen.getByText('Some detail')).toBeInTheDocument()
    })

    it('does not render description element when not provided', () => {
      const { container } = render(<QuestionOption {...defaultProps} />)

      expect(container.querySelector('.tool-option-desc')).not.toBeInTheDocument()
    })

    it('renders children after the option div', () => {
      render(
        <QuestionOption {...defaultProps}>
          <span data-testid="child">Extra content</span>
        </QuestionOption>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
    })
  })

  describe('CSS class composition', () => {
    it('includes base and interactive classes', () => {
      const { container } = render(<QuestionOption {...defaultProps} />)
      const option = container.querySelector('.tool-question-option')

      expect(option).toHaveClass('tool-question-option', 'interactive')
    })

    it('includes selected class when selected', () => {
      const { container } = render(<QuestionOption {...defaultProps} isSelected />)
      const option = container.querySelector('.tool-question-option')

      expect(option).toHaveClass('selected')
    })

    it('does not include selected class when not selected', () => {
      const { container } = render(<QuestionOption {...defaultProps} />)
      const option = container.querySelector('.tool-question-option')

      expect(option).not.toHaveClass('selected')
    })

    it('includes other class when isOther is true', () => {
      const { container } = render(<QuestionOption {...defaultProps} isOther />)
      const option = container.querySelector('.tool-question-option')

      expect(option).toHaveClass('other')
    })

    it('includes disabled class when disabled', () => {
      const { container } = render(<QuestionOption {...defaultProps} disabled />)
      const option = container.querySelector('.tool-question-option')

      expect(option).toHaveClass('disabled')
    })

    it('composes multiple classes together', () => {
      const { container } = render(<QuestionOption {...defaultProps} isSelected isOther disabled />)
      const option = container.querySelector('.tool-question-option')

      expect(option).toHaveClass(
        'tool-question-option',
        'interactive',
        'other',
        'selected',
        'disabled',
      )
    })
  })

  describe('click handling', () => {
    it('calls onClick when clicked and not disabled', () => {
      const onClick = vi.fn()
      render(<QuestionOption {...defaultProps} onClick={onClick} />)

      screen.getByText('Option A').closest('.tool-question-option').click()

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does not call onClick when disabled', () => {
      const onClick = vi.fn()
      render(<QuestionOption {...defaultProps} onClick={onClick} disabled />)

      screen.getByText('Option A').closest('.tool-question-option').click()

      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
