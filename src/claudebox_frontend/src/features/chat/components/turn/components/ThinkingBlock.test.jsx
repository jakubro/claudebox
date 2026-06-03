/** Tests for ThinkingBlock. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ThinkingBlock from './ThinkingBlock'

describe('ThinkingBlock', () => {
  const createEvent = content => ({ content })

  it('renders thinking label with hollow circle (○)', () => {
    render(<ThinkingBlock event={createEvent('Some thought')} />)

    expect(screen.getByText('○')).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()
  })

  it('shows first line as preview WITHOUT quotes', () => {
    const content = 'First line of thought\nSecond line\nThird line'
    render(<ThinkingBlock event={createEvent(content)} />)

    // No quotes around preview
    expect(screen.getByText('First line of thought')).toBeInTheDocument()
  })

  it('expands to full content on click (rendered as Markdown)', async () => {
    const user = userEvent.setup()
    const content = 'Full thinking content here'
    render(<ThinkingBlock event={createEvent(content)} />)

    // Initially shows preview text
    expect(screen.getByText(content)).toBeInTheDocument()

    // Click header button to expand
    await user.click(screen.getByText('Thinking'))

    // Shows full content rendered as Markdown
    expect(screen.getByText(content)).toBeInTheDocument()
  })

  it('collapses on second click', async () => {
    const user = userEvent.setup()
    render(<ThinkingBlock event={createEvent('Thinking content')} />)

    const header = screen.getByText('Thinking', { exact: true })

    // Initially collapsed — shows preview
    expect(screen.getByText('Thinking content')).toBeInTheDocument()

    // Click to expand
    await user.click(header)
    expect(screen.getByText('Thinking content')).toBeInTheDocument()

    // Click to collapse — still shows preview
    await user.click(header)
    expect(screen.getByText('Thinking content')).toBeInTheDocument()
  })

  it('shows only first line when collapsed, full content when expanded', async () => {
    const user = userEvent.setup()
    render(<ThinkingBlock event={createEvent('First line\nSecond line')} />)

    // Collapsed: only first line visible
    expect(screen.getByText('First line')).toBeInTheDocument()
    expect(screen.queryByText('Second line')).not.toBeInTheDocument()

    // Expand: full content visible
    await user.click(screen.getByText('Thinking'))
    expect(screen.getByText(/Second line/)).toBeInTheDocument()
  })

  it('renders expanded content as Markdown (bold, italic)', async () => {
    const user = userEvent.setup()
    render(<ThinkingBlock event={createEvent('**Bold** and _italic_ content')} />)

    await user.click(screen.getByText('Thinking'))

    // Content rendered as Markdown — bold/italic produce HTML elements
    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.getByText('Bold').tagName).toBe('STRONG')
  })

  describe('block timing', () => {
    it('renders relative time when blockRelativeTime is provided', () => {
      render(<ThinkingBlock event={createEvent('Thought')} blockRelativeTime={35} />)

      const timing = document.querySelector('.block-timing')
      expect(timing).toBeInTheDocument()
      expect(timing).toHaveTextContent('@ +35s')
    })

    it('does not render timing when blockRelativeTime is null', () => {
      render(<ThinkingBlock event={createEvent('Thought')} />)

      expect(document.querySelector('.block-timing')).not.toBeInTheDocument()
    })
  })

  it('returns null for empty content', () => {
    const { container } = render(<ThinkingBlock event={createEvent('')} />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null for whitespace-only content', () => {
    const { container } = render(<ThinkingBlock event={createEvent('   \n  ')} />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null for null event', () => {
    const { container } = render(<ThinkingBlock event={null} />)

    expect(container.innerHTML).toBe('')
  })
})
