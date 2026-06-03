/** Tests for TicketCard component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TicketCard from './TicketCard'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
    transform: null,
    transition: null,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

const baseTicket = {
  path: 'tickets/feat-1.md',
  title: 'Add authentication',
  session: null,
  status: null,
}

describe('TicketCard', () => {
  it('renders ticket title', () => {
    render(<TicketCard ticket={baseTicket} />)

    expect(screen.getByText('Add authentication')).toBeInTheDocument()
  })

  it('renders session info when ticket has session', () => {
    const ticket = { ...baseTicket, session: 'abcd1234efgh', status: 'running' }
    render(<TicketCard ticket={ticket} />)

    expect(screen.getByText(/running/)).toBeInTheDocument()
    expect(screen.getByText(/abcd/)).toBeInTheDocument()
  })

  it('does not render session info when no session', () => {
    render(<TicketCard ticket={baseTicket} />)

    expect(screen.queryByText(/running|stopped/)).not.toBeInTheDocument()
  })

  it('shows running status when status is running', () => {
    const ticket = { ...baseTicket, session: 'abcd1234efgh', status: 'running' }
    const { container } = render(<TicketCard ticket={ticket} />)

    expect(container.querySelector('.ticket-status-dot.running')).toBeInTheDocument()
    expect(screen.getByText(/running \(abcd/)).toBeInTheDocument()
  })

  it('shows stopped status when status is not running', () => {
    const ticket = { ...baseTicket, session: 'abcd1234efgh', status: 'stopped' }
    const { container } = render(<TicketCard ticket={ticket} />)

    expect(container.querySelector('.ticket-status-dot.stopped')).toBeInTheDocument()
    expect(screen.getByText(/stopped \(abcd/)).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TicketCard ticket={baseTicket} onClick={onClick} />)

    await user.click(screen.getByText('Add authentication'))

    expect(onClick).toHaveBeenCalledWith(baseTicket)
  })

  it('calls onToggleSelect on ctrl+click', async () => {
    const user = userEvent.setup()
    const onToggleSelect = vi.fn()
    const onClick = vi.fn()
    render(<TicketCard ticket={baseTicket} onClick={onClick} onToggleSelect={onToggleSelect} />)

    await user.keyboard('{Control>}')
    await user.click(screen.getByText('Add authentication'))
    await user.keyboard('{/Control}')

    expect(onToggleSelect).toHaveBeenCalledWith(baseTicket.path, expect.any(Object))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows context menu on right-click with archive option', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()
    render(<TicketCard ticket={baseTicket} onArchive={onArchive} />)

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Add authentication'),
    })

    expect(screen.getByText('Archive ticket')).toBeInTheDocument()

    await user.click(screen.getByText('Archive ticket'))

    expect(onArchive).toHaveBeenCalledWith(baseTicket.path)
  })

  it('shows context menu on right-click without archive callback', async () => {
    const user = userEvent.setup()
    render(<TicketCard ticket={baseTicket} />)

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Add authentication'),
    })

    // Context menu appears but archive does not throw
    expect(screen.getByText('Archive ticket')).toBeInTheDocument()
  })

  it('renders checkbox on every card', () => {
    render(<TicketCard ticket={baseTicket} />)

    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('checkbox is checked when isSelected', () => {
    render(<TicketCard ticket={baseTicket} isSelected />)

    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('checkbox is unchecked when not selected', () => {
    render(<TicketCard ticket={baseTicket} isSelected={false} />)

    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('calls onToggleSelect when checkbox clicked', async () => {
    const user = userEvent.setup()
    const onToggleSelect = vi.fn()
    const onClick = vi.fn()
    render(<TicketCard ticket={baseTicket} onToggleSelect={onToggleSelect} onClick={onClick} />)

    await user.click(screen.getByRole('checkbox'))

    expect(onToggleSelect).toHaveBeenCalledWith(baseTicket.path)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('applies selected class when isSelected', () => {
    const { container } = render(<TicketCard ticket={baseTicket} isSelected />)

    expect(container.querySelector('.ticket-card.selected')).toBeInTheDocument()
  })

  it('applies drag-overlay class when isDragOverlay', () => {
    const { container } = render(<TicketCard ticket={baseTicket} isDragOverlay />)

    expect(container.querySelector('.ticket-card.drag-overlay')).toBeInTheDocument()
  })
})
