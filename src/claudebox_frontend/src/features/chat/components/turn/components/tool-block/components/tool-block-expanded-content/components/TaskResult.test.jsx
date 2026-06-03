/** Tests for TaskResult component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TaskResult from './TaskResult'

// Mock child components used by CollapsibleSection
vi.mock('../../../../../../../../../components/CopyButton', () => ({
  default: () => (
    <button data-testid="copy-button" type="button">
      Copy
    </button>
  ),
}))

vi.mock('../../../../../../../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

describe('TaskResult', () => {
  it('returns null when result is undefined', () => {
    const { container } = render(<TaskResult />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null when result is empty string', () => {
    const { container } = render(<TaskResult result="" />)

    expect(container.innerHTML).toBe('')
  })

  it('shows first line as preview when collapsed', () => {
    render(<TaskResult result="First line" />)

    expect(screen.getByText('First line')).toBeInTheDocument()
  })

  it('shows ellipsis for multiline result when collapsed', () => {
    render(<TaskResult result={'First line\nSecond line'} />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview.textContent).toBe('First line…')
  })

  it('shows no ellipsis for single-line result when collapsed', () => {
    render(<TaskResult result="Only one line" />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview.textContent).toBe('Only one line')
  })

  it('shows Result label', () => {
    render(<TaskResult result="Some result" />)

    expect(screen.getByText('Result')).toBeInTheDocument()
  })

  it('expands to show full content when header is clicked', () => {
    render(<TaskResult result={'First line\nSecond line'} />)

    fireEvent.click(screen.getByRole('button'))

    const markdown = screen.getByTestId('markdown')
    expect(markdown.textContent).toContain('First line')
    expect(markdown.textContent).toContain('Second line')
  })

  it('hides preview when expanded', () => {
    render(<TaskResult result={'First line\nSecond line'} />)

    fireEvent.click(screen.getByRole('button'))

    expect(document.querySelector('.collapsible-preview')).not.toBeInTheDocument()
  })

  it('collapses on second click', () => {
    render(<TaskResult result="Some result" />)

    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByTestId('markdown')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('starts expanded when defaultExpanded is true', () => {
    render(<TaskResult result="Already open" defaultExpanded={true} />)

    expect(screen.getByTestId('markdown')).toBeInTheDocument()
    expect(document.querySelector('.collapsible-preview')).not.toBeInTheDocument()
  })

  it('sets title attribute on preview for full result tooltip', () => {
    const fullResult = 'First line\nSecond line\nThird line'
    render(<TaskResult result={fullResult} />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview).toHaveAttribute('title', fullResult)
  })

  it('applies task-result class for styling', () => {
    render(<TaskResult result="Some result" />)

    expect(document.querySelector('.task-result')).toBeInTheDocument()
  })
})
