/** Tests for TaskPrompt component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TaskPrompt from './TaskPrompt'

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

describe('TaskPrompt', () => {
  it('returns null when prompt is undefined', () => {
    const { container } = render(<TaskPrompt />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null when prompt is empty string', () => {
    const { container } = render(<TaskPrompt prompt="" />)

    expect(container.innerHTML).toBe('')
  })

  it('shows first line as preview when collapsed', () => {
    render(<TaskPrompt prompt="First line" />)

    expect(screen.getByText('First line')).toBeInTheDocument()
  })

  it('shows ellipsis for multiline prompt when collapsed', () => {
    render(<TaskPrompt prompt={'First line\nSecond line'} />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview.textContent).toBe('First line…')
  })

  it('shows no ellipsis for single-line prompt when collapsed', () => {
    render(<TaskPrompt prompt="Only one line" />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview.textContent).toBe('Only one line')
  })

  it('shows Prompt label', () => {
    render(<TaskPrompt prompt="Some prompt" />)

    expect(screen.getByText('Prompt')).toBeInTheDocument()
  })

  it('expands to show full content when header is clicked', () => {
    render(<TaskPrompt prompt={'First line\nSecond line'} />)

    fireEvent.click(screen.getByRole('button'))

    const markdown = screen.getByTestId('markdown')
    expect(markdown.textContent).toContain('First line')
    expect(markdown.textContent).toContain('Second line')
  })

  it('hides preview when expanded', () => {
    render(<TaskPrompt prompt={'First line\nSecond line'} />)

    fireEvent.click(screen.getByRole('button'))

    expect(document.querySelector('.collapsible-preview')).not.toBeInTheDocument()
  })

  it('collapses on second click', () => {
    render(<TaskPrompt prompt="Some prompt" />)

    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByTestId('markdown')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('starts expanded when defaultExpanded is true', () => {
    render(<TaskPrompt prompt="Already open" defaultExpanded={true} />)

    expect(screen.getByTestId('markdown')).toBeInTheDocument()
    expect(document.querySelector('.collapsible-preview')).not.toBeInTheDocument()
  })

  it('sets title attribute on preview for full prompt tooltip', () => {
    const fullPrompt = 'First line\nSecond line\nThird line'
    render(<TaskPrompt prompt={fullPrompt} />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview).toHaveAttribute('title', fullPrompt)
  })

  it('applies task-prompt class for styling', () => {
    render(<TaskPrompt prompt="Some prompt" />)

    expect(document.querySelector('.task-prompt')).toBeInTheDocument()
  })
})
