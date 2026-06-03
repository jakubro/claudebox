/** Tests for InteractiveQuestions. */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InteractiveQuestions from './InteractiveQuestions'

const singleQuestion = [
  {
    header: 'Question 1',
    question: 'Pick a color',
    multiSelect: false,
    options: [
      { label: 'Red', description: 'A warm color' },
      { label: 'Blue', description: 'A cool color' },
    ],
  },
]

const multiQuestion = [
  {
    header: 'Question 1',
    question: 'Pick colors',
    multiSelect: true,
    options: [
      { label: 'Red', description: 'A warm color' },
      { label: 'Blue', description: 'A cool color' },
      { label: 'Green', description: 'A natural color' },
    ],
  },
]

describe('InteractiveQuestions', () => {
  let onSubmit

  beforeEach(() => {
    onSubmit = vi.fn()
  })

  it('renders question header and text', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    expect(screen.getByText('Question 1')).toBeInTheDocument()
    expect(screen.getByText('Pick a color')).toBeInTheDocument()
  })

  it('renders all options including Other', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('Blue')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('selects a single option on click', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Red'))

    // After selecting, the radio indicator should show filled
    expect(screen.getByText('Red').closest('.tool-question-option')).toHaveClass('selected')
  })

  it('switches selection in single-select mode', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Red'))
    expect(screen.getByText('Red').closest('.tool-question-option')).toHaveClass('selected')

    fireEvent.click(screen.getByText('Blue'))
    expect(screen.getByText('Blue').closest('.tool-question-option')).toHaveClass('selected')
    expect(screen.getByText('Red').closest('.tool-question-option')).not.toHaveClass('selected')
  })

  it('toggles multiple options in multi-select mode', () => {
    render(<InteractiveQuestions questions={multiQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Red'))
    fireEvent.click(screen.getByText('Blue'))

    expect(screen.getByText('Red').closest('.tool-question-option')).toHaveClass('selected')
    expect(screen.getByText('Blue').closest('.tool-question-option')).toHaveClass('selected')
    expect(screen.getByText('Green').closest('.tool-question-option')).not.toHaveClass('selected')
  })

  it('deselects option in multi-select mode on second click', () => {
    render(<InteractiveQuestions questions={multiQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Red'))
    expect(screen.getByText('Red').closest('.tool-question-option')).toHaveClass('selected')

    fireEvent.click(screen.getByText('Red'))
    expect(screen.getByText('Red').closest('.tool-question-option')).not.toHaveClass('selected')
  })

  it('shows Other textarea when Other is clicked', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Other'))

    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('clears Other selection when a regular option is selected in single-select', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    // Select Other first
    fireEvent.click(screen.getByText('Other'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()

    // Select a regular option
    fireEvent.click(screen.getByText('Red'))

    // Other textarea should disappear
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('submit button is disabled when no selection is made', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    expect(screen.getByText('Submit Response').closest('button')).toBeDisabled()
  })

  it('submit button is enabled after selecting an option', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Red'))

    expect(screen.getByText('Submit Response').closest('button')).not.toBeDisabled()
  })

  it('calls onSubmit with XML when submitted', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Red'))
    fireEvent.click(screen.getByText('Submit Response'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('<response:AskUserQuestion>'))
  })

  it('uses custom responseTag in XML wrapper when provided', () => {
    render(
      <InteractiveQuestions
        questions={singleQuestion}
        onSubmit={onSubmit}
        responseTag="ExitPlanMode"
      />,
    )

    fireEvent.click(screen.getByText('Red'))
    fireEvent.click(screen.getByText('Submit Response'))

    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('<response:ExitPlanMode>'))
    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('</response:ExitPlanMode>'))
  })

  it('does not render submit button when disabled', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} disabled />)

    expect(screen.queryByText('Submit Response')).not.toBeInTheDocument()
  })

  it('does not toggle selection when disabled', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} disabled />)

    fireEvent.click(screen.getByText('Red'))

    expect(screen.getByText('Red').closest('.tool-question-option')).not.toHaveClass('selected')
  })

  it('adds disabled class to root when disabled', () => {
    const { container } = render(
      <InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} disabled />,
    )

    expect(container.firstChild).toHaveClass('disabled')
  })

  it('enables submit when Other text is provided', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Other'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Custom answer' } })

    expect(screen.getByText('Submit Response').closest('button')).not.toBeDisabled()
  })

  it('keeps submit disabled when Other is selected but text is empty', () => {
    render(<InteractiveQuestions questions={singleQuestion} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Other'))

    expect(screen.getByText('Submit Response').closest('button')).toBeDisabled()
  })
})
