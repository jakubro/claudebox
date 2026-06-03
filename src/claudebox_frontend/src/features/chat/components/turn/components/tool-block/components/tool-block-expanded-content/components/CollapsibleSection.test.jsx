/** Tests for CollapsibleSection component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CollapsibleSection from './CollapsibleSection'

// Mock child components
vi.mock('../../../../../../../../../components/CopyButton', () => ({
  default: ({ title }) => (
    <button data-testid="copy-button" type="button">
      {title || 'Copy'}
    </button>
  ),
}))

vi.mock('../../../../../../../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

describe('CollapsibleSection', () => {
  it('returns null when content and children are undefined', () => {
    const { container } = render(<CollapsibleSection label="Test" />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null when content is empty string and no children', () => {
    const { container } = render(<CollapsibleSection label="Test" content="" />)

    expect(container.innerHTML).toBe('')
  })

  it('shows first line as preview when collapsed', () => {
    render(<CollapsibleSection label="Test" content="First line" />)

    expect(screen.getByText('First line')).toBeInTheDocument()
  })

  it('shows ellipsis for multiline content when collapsed', () => {
    render(<CollapsibleSection label="Test" content={'First line\nSecond line'} />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview.textContent).toBe('First line…')
  })

  it('shows no ellipsis for single-line content when collapsed', () => {
    render(<CollapsibleSection label="Test" content="Only one line" />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview.textContent).toBe('Only one line')
  })

  it('shows the label', () => {
    render(<CollapsibleSection label="MyLabel" content="Some content" />)

    expect(screen.getByText('MyLabel')).toBeInTheDocument()
  })

  it('expands to show full content when header is clicked', () => {
    render(<CollapsibleSection label="Test" content={'First line\nSecond line'} />)

    fireEvent.click(screen.getByRole('button'))

    const markdown = screen.getByTestId('markdown')
    expect(markdown.textContent).toContain('First line')
    expect(markdown.textContent).toContain('Second line')
  })

  it('hides preview when expanded', () => {
    render(<CollapsibleSection label="Test" content={'First line\nSecond line'} />)

    fireEvent.click(screen.getByRole('button'))

    expect(document.querySelector('.collapsible-preview')).not.toBeInTheDocument()
  })

  it('collapses on second click', () => {
    render(<CollapsibleSection label="Test" content="Some content" />)

    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByTestId('markdown')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('starts expanded when defaultExpanded is true', () => {
    render(<CollapsibleSection label="Test" content="Already open" defaultExpanded={true} />)

    expect(screen.getByTestId('markdown')).toBeInTheDocument()
    expect(document.querySelector('.collapsible-preview')).not.toBeInTheDocument()
  })

  it('sets title attribute on preview for full content tooltip', () => {
    const fullContent = 'First line\nSecond line\nThird line'
    render(<CollapsibleSection label="Test" content={fullContent} />)

    const preview = document.querySelector('.collapsible-preview')
    expect(preview).toHaveAttribute('title', fullContent)
  })

  it('shows copy button when showCopy is true and expanded', () => {
    render(<CollapsibleSection label="Test" content="Content" showCopy defaultExpanded />)

    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
  })

  it('does not show copy button when showCopy is false', () => {
    render(<CollapsibleSection label="Test" content="Content" defaultExpanded />)

    expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument()
  })

  it('passes label to copy button title', () => {
    render(<CollapsibleSection label="Prompt" content="Content" showCopy defaultExpanded />)

    expect(screen.getByTestId('copy-button').textContent).toBe('Copy prompt')
  })

  it('applies custom className to wrapper', () => {
    render(<CollapsibleSection label="Test" content="Content" className="custom-class" />)

    const wrapper = document.querySelector('.collapsible-section')
    expect(wrapper).toHaveClass('custom-class')
  })

  it('renders children instead of content when children provided', () => {
    render(
      <CollapsibleSection label="Test" defaultExpanded>
        <div data-testid="custom-child">Custom content</div>
      </CollapsibleSection>,
    )

    expect(screen.getByTestId('custom-child')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('does not show preview when using children', () => {
    render(
      <CollapsibleSection label="Test">
        <div>Custom content</div>
      </CollapsibleSection>,
    )

    expect(document.querySelector('.collapsible-preview')).not.toBeInTheDocument()
  })

  it('prefers content over children when both provided', () => {
    render(
      <CollapsibleSection label="Test" content="Text content" defaultExpanded>
        <div data-testid="custom-child">Custom content</div>
      </CollapsibleSection>,
    )

    expect(screen.getByTestId('markdown')).toBeInTheDocument()
    expect(screen.queryByTestId('custom-child')).not.toBeInTheDocument()
  })
})
