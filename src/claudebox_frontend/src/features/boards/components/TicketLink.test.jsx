/** Tests for TicketLink - terse-density inline ticket rendering. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TicketLink from './TicketLink'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

const baseTicket = {
  path: 'tickets/active/99.001-fixture-ticket.md',
  title: 'Fixture ticket',
  session: null,
}

describe('TicketLink', () => {
  it('renders extracted ticket ID as the link text', () => {
    render(<TicketLink ticket={baseTicket} />)
    expect(screen.getByText('99.001')).toBeInTheDocument()
  })

  it('shows ticket title in the hover tooltip', () => {
    render(<TicketLink ticket={baseTicket} />)
    const link = screen.getByText('99.001')
    expect(link).toHaveAttribute('title', 'Fixture ticket')
  })

  it('applies session-active class when ticket has a session', () => {
    const ticket = { ...baseTicket, session: 'sess-1' }
    const { container } = render(<TicketLink ticket={ticket} />)
    expect(container.querySelector('.ticket-link.session-active')).toBeInTheDocument()
  })

  it('omits session-active class without a session', () => {
    const { container } = render(<TicketLink ticket={baseTicket} />)
    expect(container.querySelector('.ticket-link.session-active')).not.toBeInTheDocument()
  })

  it('applies selected class when isSelected', () => {
    const { container } = render(<TicketLink ticket={baseTicket} isSelected />)
    expect(container.querySelector('.ticket-link.selected')).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TicketLink ticket={baseTicket} onClick={onClick} />)
    await user.click(screen.getByText('99.001'))
    expect(onClick).toHaveBeenCalledWith(baseTicket)
  })

  it('calls onToggleSelect on ctrl+click instead of onClick', async () => {
    const user = userEvent.setup()
    const onToggleSelect = vi.fn()
    const onClick = vi.fn()
    render(<TicketLink ticket={baseTicket} onClick={onClick} onToggleSelect={onToggleSelect} />)
    await user.keyboard('{Control>}')
    await user.click(screen.getByText('99.001'))
    await user.keyboard('{/Control}')
    expect(onToggleSelect).toHaveBeenCalledWith(baseTicket.path, expect.any(Object))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows context menu on right-click and triggers archive', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()
    render(<TicketLink ticket={baseTicket} onArchive={onArchive} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('99.001') })
    expect(screen.getByText('Archive ticket')).toBeInTheDocument()
    await user.click(screen.getByText('Archive ticket'))
    expect(onArchive).toHaveBeenCalledWith(baseTicket.path)
  })
})
