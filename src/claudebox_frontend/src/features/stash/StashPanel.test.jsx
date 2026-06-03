/** Tests for StashPanel component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import StashPanel from './StashPanel'

// Mock lucide-react
vi.mock('lucide-react', () => ({
  CornerRightUp: () => <span data-testid="icon-pop">↗</span>,
}))

// Mock CopyButton - capture props for testing
const mockCopyButtonProps = { text: null }
vi.mock('../../components/CopyButton', () => ({
  default: ({ text }) => {
    mockCopyButtonProps.text = text
    return (
      <button data-testid="copy-button" type="button">
        Copy
      </button>
    )
  },
}))

// Mock EventsContext
const mockEventsData = { isResuming: false, isReplaying: false }
vi.mock('../../context/EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

// Mock StashContext
const mockStashData = {
  stash: [],
  stashRemove: vi.fn(),
}

vi.mock('../../context/StashContext', () => ({
  useStash: () => mockStashData,
}))

describe('StashPanel', () => {
  beforeEach(() => {
    mockStashData.stash = []
    mockStashData.stashRemove.mockClear()
    mockEventsData.isResuming = false
    mockEventsData.isReplaying = false
  })

  it('renders empty state with hint', () => {
    render(<StashPanel />)

    expect(screen.getByText('No stashed items')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+S to stash')).toBeInTheDocument()
  })

  it('renders stash items with first line preview', () => {
    mockStashData.stash = [
      { text: 'First line\nSecond line', timestamp: 1 },
      { text: 'Another item', timestamp: 2 },
    ]

    render(<StashPanel />)

    expect(screen.getByText('First line')).toBeInTheDocument()
    expect(screen.getByText('Another item')).toBeInTheDocument()
  })

  it('passes correct text to CopyButton', () => {
    mockStashData.stash = [{ text: 'Item to copy', timestamp: 1 }]

    render(<StashPanel />)

    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
    expect(mockCopyButtonProps.text).toBe('Item to copy')
  })

  it('calls stashRemove on remove button click', async () => {
    const user = userEvent.setup()
    mockStashData.stash = [{ text: 'Item to remove', timestamp: 1 }]

    render(<StashPanel />)

    await user.click(screen.getByTitle('Insert into input and remove'))

    expect(mockStashData.stashRemove).toHaveBeenCalledWith(0)
  })

  it('shows keyboard shortcuts in footer', () => {
    mockStashData.stash = [{ text: 'Item', timestamp: 1 }]

    render(<StashPanel />)

    expect(screen.getByText('Ctrl+S to stash | Ctrl+Shift+S to pop')).toBeInTheDocument()
  })

  describe('isReplaying', () => {
    it('shows "Resuming..." in the loading state when isReplaying is true', () => {
      mockEventsData.isReplaying = true

      render(<StashPanel />)

      expect(screen.getByText('Resuming...')).toBeInTheDocument()
      // Resuming is a loading state (data not yet hydrated), not an empty state.
      const root = screen.getByTestId('panel-stash')
      expect(root).toHaveClass('stash-loading')
      expect(root).not.toHaveClass('stash-empty')
    })

    it('does not show stash items when isReplaying is true', () => {
      mockEventsData.isReplaying = true
      mockStashData.stash = [{ text: 'Should not appear', timestamp: 1 }]

      render(<StashPanel />)

      expect(screen.queryByTestId('stash-item')).not.toBeInTheDocument()
      expect(screen.getByText('Resuming...')).toBeInTheDocument()
    })

    it('shows "Resuming..." when isResuming is true (before replay starts)', () => {
      mockEventsData.isResuming = true

      render(<StashPanel />)

      expect(screen.getByText('Resuming...')).toBeInTheDocument()
      expect(screen.getByTestId('panel-stash')).toHaveClass('stash-loading')
    })
  })

  describe('full-text tooltip', () => {
    it('sets title attribute to full text on stash items', () => {
      const fullText = 'First line\nSecond line\nThird line'
      mockStashData.stash = [{ text: fullText, timestamp: 1 }]

      render(<StashPanel />)

      const item = screen.getByTestId('stash-item')
      expect(item).toHaveAttribute('title', fullText)
    })

    it('sets title to full text even for single-line items', () => {
      mockStashData.stash = [{ text: 'Single line', timestamp: 1 }]

      render(<StashPanel />)

      const item = screen.getByTestId('stash-item')
      expect(item).toHaveAttribute('title', 'Single line')
    })
  })
})
