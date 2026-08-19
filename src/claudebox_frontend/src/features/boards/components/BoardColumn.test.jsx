/** Tests for BoardColumn component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BoardColumn from './BoardColumn'

const mockDroppable = { isOver: false }
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: mockDroppable.isOver,
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

vi.mock('./TicketLink', () => ({
  default: ({ ticket }) => <div data-testid={`link-${ticket.path}`}>{ticket.title}</div>,
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
  beforeEach(() => {
    mockDroppable.isOver = false
    defaultProps.onToggleSelect.mockClear()
    defaultProps.onClickTicket.mockClear()
    defaultProps.onArchive.mockClear()
  })

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

  it('applies the drag-over class when a drag is hovering', () => {
    mockDroppable.isOver = true
    const { container } = render(<BoardColumn {...defaultProps} tickets={[]} />)

    expect(container.querySelector('.drag-over')).toBeInTheDocument()
  })

  it('renders comma-separated ticket links in terse density', () => {
    const tickets = makeTickets(2)
    const { container } = render(
      <BoardColumn {...defaultProps} tickets={tickets} density="terse" />,
    )

    expect(screen.getByTestId('link-tickets/t-0.md')).toBeInTheDocument()
    expect(screen.getByTestId('link-tickets/t-1.md')).toBeInTheDocument()
    expect(container.querySelector('.board-cell.terse')).toBeInTheDocument()
    expect(container.textContent).toContain(', ')
  })

  it('opens a cell context menu on right-click with the state/swimlane archive label', async () => {
    const user = userEvent.setup()
    const tickets = makeTickets(2)
    render(
      <BoardColumn
        {...defaultProps}
        tickets={tickets}
        columnLabel="Backlog"
        swimlaneName="Frontend"
      />,
    )

    await user.pointer({ keys: '[MouseRight]', target: document.querySelector('.board-cell') })

    expect(
      screen.getByText('Archive all tickets in Backlog state and Frontend swimlane (2 tickets)'),
    ).toBeInTheDocument()
  })

  it('falls back to raw column/swimlane ids when labels are not provided', async () => {
    const user = userEvent.setup()
    render(<BoardColumn {...defaultProps} tickets={[]} />)

    await user.pointer({ keys: '[MouseRight]', target: document.querySelector('.board-cell') })

    expect(
      screen.getByText('Archive all tickets in backlog state and lane-1 swimlane (0 tickets)'),
    ).toBeDisabled()
  })

  it('closes the cell context menu on backdrop click', async () => {
    const user = userEvent.setup()
    render(<BoardColumn {...defaultProps} tickets={makeTickets(1)} />)

    await user.pointer({ keys: '[MouseRight]', target: document.querySelector('.board-cell') })
    expect(document.querySelector('.swimlane-context-menu')).toBeInTheDocument()

    await user.click(document.querySelector('.swimlane-context-backdrop'))
    expect(document.querySelector('.swimlane-context-menu')).not.toBeInTheDocument()
  })

  it('bulk-archives the cell via the context menu and closes it', async () => {
    const user = userEvent.setup()
    const tickets = makeTickets(2)
    const onArchiveCell = vi.fn()
    render(<BoardColumn {...defaultProps} tickets={tickets} onArchiveCell={onArchiveCell} />)

    await user.pointer({ keys: '[MouseRight]', target: document.querySelector('.board-cell') })
    await user.click(
      screen.getByText('Archive all tickets in backlog state and lane-1 swimlane (2 tickets)'),
    )

    expect(onArchiveCell).toHaveBeenCalledWith(tickets)
    expect(document.querySelector('.swimlane-context-menu')).not.toBeInTheDocument()
  })

  it('supports the context menu on a collapsed cell too', async () => {
    const user = userEvent.setup()
    render(<BoardColumn {...defaultProps} tickets={makeTickets(3)} collapsed />)

    await user.pointer({ keys: '[MouseRight]', target: document.querySelector('.board-cell') })

    expect(
      screen.getByText('Archive all tickets in backlog state and lane-1 swimlane (3 tickets)'),
    ).toBeInTheDocument()
  })
})
