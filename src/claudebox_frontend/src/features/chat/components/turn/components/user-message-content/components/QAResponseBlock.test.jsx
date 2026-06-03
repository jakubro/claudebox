/** Tests for QAResponseBlock component. */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react', () => ({ Check: props => <svg data-testid="check-icon" {...props} /> }))

import QAResponseBlock from './QAResponseBlock'

const makeQuestions = (overrides = []) => [
  {
    header: 'Question 1',
    text: 'What is your name?',
    answers: ['Alice'],
  },
  {
    header: 'Question 2',
    text: 'Where do you live?',
    answers: ['Wonderland'],
  },
  ...overrides,
]

describe('QAResponseBlock', () => {
  it('renders header with Check icon and Response label', () => {
    const { getByTestId, getByText } = render(<QAResponseBlock questions={makeQuestions()} />)
    expect(getByTestId('check-icon')).toBeDefined()
    expect(getByText('Response')).toBeDefined()
  })

  it('renders questions with headers and text', () => {
    const { getByText } = render(<QAResponseBlock questions={makeQuestions()} />)
    expect(getByText('Question 1')).toBeDefined()
    expect(getByText('What is your name?')).toBeDefined()
    expect(getByText('Question 2')).toBeDefined()
    expect(getByText('Where do you live?')).toBeDefined()
  })

  it('renders answers', () => {
    const { getAllByTestId } = render(<QAResponseBlock questions={makeQuestions()} />)
    const answers = getAllByTestId('qa-answer')
    expect(answers).toHaveLength(2)
    expect(answers[0].textContent).toBe('Alice')
    expect(answers[1].textContent).toBe('Wonderland')
  })

  it('appends extra newline to answers ending with \\n', () => {
    const questions = [{ header: 'Q', text: 'T', answers: ['line\n'] }]
    const { getByTestId } = render(<QAResponseBlock questions={questions} />)
    expect(getByTestId('qa-answer').textContent).toBe('line\n\n')
  })
})
