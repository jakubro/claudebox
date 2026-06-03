/** Tests for CompactionBlock. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CompactionBlock from './CompactionBlock'

// Mock Markdown (heavy remark dependency)
vi.mock('../../../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

// Real LocalCommandBlock, real lucide-react, real formatters, real parsers

describe('CompactionBlock', () => {
  const createEvent = (preTokens, trigger = 'context_window') => ({
    message_data: {
      compact_metadata: {
        pre_tokens: preTokens,
        trigger,
      },
    },
  })

  it('shows spinner text while isCompacting=true', () => {
    render(<CompactionBlock event={createEvent(50000)} isCompacting={true} />)

    expect(screen.getByText('Compacting conversation...')).toBeInTheDocument()
  })

  it('shows token count and trigger when complete', () => {
    render(<CompactionBlock event={createEvent(128000, 'context_window')} isCompacting={false} />)

    expect(screen.getByText('Conversation compacted')).toBeInTheDocument()
    expect(screen.getByText(/128K tokens, context_window/)).toBeInTheDocument()
  })

  it('expands to show summary on click', async () => {
    const user = userEvent.setup()
    const summary = ['Summary of the compacted conversation']
    render(<CompactionBlock event={createEvent(50000)} summary={summary} isCompacting={false} />)

    // Initially not showing summary
    expect(screen.queryByText(summary[0])).not.toBeInTheDocument()

    // Click header text to expand
    await user.click(screen.getByText('Conversation compacted'))

    // Now shows summary text
    expect(screen.getByText(summary[0])).toBeInTheDocument()
  })

  it('formats token count (e.g., "128K tokens")', () => {
    render(<CompactionBlock event={createEvent(128000)} isCompacting={false} />)

    expect(screen.getByText(/128K tokens/)).toBeInTheDocument()
  })

  it('formats smaller token counts without K suffix', () => {
    render(<CompactionBlock event={createEvent(500)} isCompacting={false} />)

    expect(screen.getByText(/500 tokens/)).toBeInTheDocument()
  })

  it('collapses summary on second click', async () => {
    const user = userEvent.setup()
    const summary = ['Summary content']
    render(<CompactionBlock event={createEvent(50000)} summary={summary} isCompacting={false} />)

    const headerText = screen.getByText('Conversation compacted')

    // Expand
    await user.click(headerText)
    expect(screen.getByText('Summary content')).toBeInTheDocument()

    // Collapse
    await user.click(headerText)
    expect(screen.queryByText('Summary content')).not.toBeInTheDocument()
  })

  it('handles missing metadata gracefully', () => {
    const event = {}
    render(<CompactionBlock event={event} isCompacting={false} />)

    expect(screen.getByText('Conversation compacted')).toBeInTheDocument()
    expect(screen.getByText(/unknown/)).toBeInTheDocument()
  })
})
