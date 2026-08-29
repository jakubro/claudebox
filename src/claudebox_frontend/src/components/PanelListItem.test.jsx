/** Tests for PanelListItem component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PanelListItem from './PanelListItem.jsx'

function Glyph() {
  return <svg data-testid="glyph" />
}

describe('PanelListItem', () => {
  it('renders the label as text when no icon is given', () => {
    render(<PanelListItem label="Conversations" active={false} onClick={vi.fn()} />)

    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('Conversations')
    expect(button).not.toHaveAttribute('title')
    expect(button).not.toHaveAttribute('aria-label')
  })

  it('renders the icon instead of text when icon is given, with label as tooltip and accessible name', () => {
    render(<PanelListItem label="Conversations" icon={Glyph} active={false} onClick={vi.fn()} />)

    const button = screen.getByRole('button')
    expect(screen.getByTestId('glyph')).toBeInTheDocument()
    expect(button).not.toHaveTextContent('Conversations')
    expect(button).toHaveAttribute('title', 'Conversations')
    expect(button).toHaveAttribute('aria-label', 'Conversations')
  })

  it('shows a count badge when count is greater than zero, with or without an icon', () => {
    render(<PanelListItem label="Named" icon={Glyph} count={4} active={false} onClick={vi.fn()} />)

    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('hides the count badge at zero unless showZero is set', () => {
    const { rerender } = render(
      <PanelListItem label="Named" count={0} active={false} onClick={vi.fn()} />,
    )
    expect(screen.queryByText('0')).not.toBeInTheDocument()

    rerender(<PanelListItem label="Named" count={0} showZero active={false} onClick={vi.fn()} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<PanelListItem label="Named" icon={Glyph} active={false} onClick={onClick} />)

    await user.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('carries the active class when active', () => {
    render(<PanelListItem label="Named" icon={Glyph} active={true} onClick={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveClass('active')
  })
})
