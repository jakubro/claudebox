/** Tests for TurnMeta component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react', () => ({
  Bookmark: props => <svg data-testid="bookmark-icon" {...props} />,
  ChevronDown: () => <svg data-testid="chevron-down" />,
  ChevronRight: () => <svg data-testid="chevron-right" />,
}))

vi.mock('../../../../../components/CopyButton.jsx', () => ({
  default: ({ text }) => (
    <button type="button" data-testid="copy-btn">
      {text}
    </button>
  ),
}))

vi.mock('../../../../../utils/formatters', () => ({
  formatDuration: d => `${d}s`,
  formatRelativeTime: () => 'just now',
}))

import TurnMeta from './TurnMeta'

const baseProps = {
  startTime: Date.now(),
  duration: 5,
  canCollapse: false,
  collapsed: false,
  onToggleCollapse: vi.fn(),
  assistantTextContent: 'Hello world',
  turnId: null,
  isBookmarked: false,
  onToggleBookmark: undefined,
}

describe('TurnMeta', () => {
  it('renders duration and timestamp', () => {
    render(<TurnMeta {...baseProps} />)
    expect(screen.getByText('5s')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('shows collapsible class and chevron when canCollapse', () => {
    const { container } = render(<TurnMeta {...baseProps} canCollapse />)
    expect(container.querySelector('.turn-meta-collapsible')).toBeInTheDocument()
    expect(
      screen.getByTestId('chevron-down') || screen.getByTestId('chevron-right'),
    ).toBeInTheDocument()
  })

  it('shows ChevronRight when collapsed', () => {
    render(<TurnMeta {...baseProps} canCollapse collapsed />)
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument()
  })

  it('shows ChevronDown when not collapsed', () => {
    render(<TurnMeta {...baseProps} canCollapse collapsed={false} />)
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument()
  })

  it('shows copy button when canCollapse and has text and not collapsed', () => {
    render(
      <TurnMeta {...baseProps} canCollapse collapsed={false} assistantTextContent="Some text" />,
    )
    expect(screen.getByTestId('copy-btn')).toBeInTheDocument()
  })

  it('hides copy button when collapsed', () => {
    render(<TurnMeta {...baseProps} canCollapse collapsed assistantTextContent="Some text" />)
    expect(screen.queryByTestId('copy-btn')).not.toBeInTheDocument()
  })

  it('shows bookmark button when turnId and onToggleBookmark provided', () => {
    render(<TurnMeta {...baseProps} turnId="turn-1" onToggleBookmark={vi.fn()} />)
    expect(screen.getByRole('button', { name: /bookmark/i })).toBeInTheDocument()
  })

  it('bookmark button has active class when isBookmarked', () => {
    render(<TurnMeta {...baseProps} turnId="turn-1" isBookmarked onToggleBookmark={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /remove bookmark/i })
    expect(btn).toHaveClass('active')
  })

  it('calls onToggleBookmark with turnId on bookmark click', async () => {
    const onToggleBookmark = vi.fn()
    render(
      <TurnMeta
        {...baseProps}
        turnId="turn-1"
        onToggleBookmark={onToggleBookmark}
        assistantTextContent="Hello world"
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /bookmark/i }))
    expect(onToggleBookmark).toHaveBeenCalledWith('turn-1', 'assistant', 'Hello world')
  })
})
