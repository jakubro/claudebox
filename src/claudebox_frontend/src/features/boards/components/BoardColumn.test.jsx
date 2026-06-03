/** Tests for BoardColumn component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BoardColumn from './BoardColumn'

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }) => children,
  verticalListSortingStrategy: {},
}))

vi.mock('./TicketCard', () => ({
  default: ({ ticket, onArchive }) => (
    <div data-testid={`ticket-${ticket.path}`} data-has-archive={!!onArchive}>
      {ticket.title}
    </div>
  ),
}))

const makeTickets = count =>
  Array.from({ length: count }, (_, i) => ({
    path: `tickets/t-${i}.md`,
    title: `Ticket ${i}`,
  }))

const defaultProps = {
  columnKey: 'backlog',
  swimlaneId: 'lane-1',
  collapsed: false,
  tickets: [],
  selectedTickets: new Set(),
  onToggleSelect: vi.fn(),
  onClickTicket: vi.fn(),
  onArchive: vi.fn(),
}

describe('BoardColumn', () => {
  it('renders ticket cards for all tickets', () => {
    const tickets = makeTickets(3)
    render(<BoardColumn {...defaultProps} tickets={tickets} />)

    expect(screen.getByTestId('ticket-tickets/t-0.md')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-tickets/t-1.md')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-tickets/t-2.md')).toBeInTheDocument()
  })

  it('shows count-only when collapsed with tickets', () => {
    const tickets = makeTickets(5)
    render(<BoardColumn {...defaultProps} tickets={tickets} collapsed columnLabel="Backlog" />)

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.queryByText('Backlog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ticket-tickets/t-0.md')).not.toBeInTheDocument()
  })

  it('renders blank collapsed cell when no tickets', () => {
    const { container } = render(
      <BoardColumn {...defaultProps} tickets={[]} collapsed columnLabel="Backlog" />,
    )

    expect(container.querySelector('.board-cell-count')).not.toBeInTheDocument()
    expect(container.querySelector('.board-cell-label')).not.toBeInTheDocument()
  })

  it('shows empty cell when no tickets and not collapsed', () => {
    const { container } = render(<BoardColumn {...defaultProps} tickets={[]} />)

    expect(container.querySelector('.board-cell')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid]')).toHaveLength(0)
  })

  it('does not apply drag-over class by default', () => {
    const { container } = render(<BoardColumn {...defaultProps} tickets={[]} />)

    expect(container.querySelector('.board-cell')).toBeInTheDocument()
    expect(container.querySelector('.drag-over')).not.toBeInTheDocument()
  })

  it('passes onArchive to all columns', () => {
    const tickets = makeTickets(1)
    render(<BoardColumn {...defaultProps} columnKey="backlog" tickets={tickets} />)
    const card = screen.getByTestId('ticket-tickets/t-0.md')
    expect(card.dataset.hasArchive).toBe('true')
  })
})
