/** Tests for TicketDetail component. */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getTicketContent } from '../../../api/boards'
import TicketDetail from './TicketDetail'

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-close">X</span>,
}))

vi.mock('../../../components/Markdown', () => ({
  default: ({ children, className }) => (
    <div data-testid="markdown" className={className}>
      {children}
    </div>
  ),
}))

vi.mock('../../../api/boards', () => ({
  getTicketContent: vi.fn(),
}))

const baseTicket = {
  path: 'tickets/feat-1.md',
  title: 'Add authentication',
  column: 'in-progress',
  swimlane: 'sprint-1',
  session: 'abcd1234efgh5678',
  status: 'running',
  boardId: 'test-board',
}

const defaultStates = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
]

const defaultSwimlanes = [
  { id: 'sprint-1', name: 'Sprint 1' },
  { id: 'sprint-2', name: 'Sprint 2' },
]

describe('TicketDetail', () => {
  beforeEach(() => {
    vi.mocked(getTicketContent).mockClear()
    vi.mocked(getTicketContent).mockResolvedValue('# Ticket content')
  })

  it('renders ticket title', () => {
    render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Add authentication')).toBeInTheDocument()
  })

  it('renders ticket metadata with label lookup', () => {
    render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Swimlane')).toBeInTheDocument()
    expect(screen.getByText('Sprint 1')).toBeInTheDocument()
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.getByText('abcd1234 (running)')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    vi.mocked(getTicketContent).mockReturnValue(new Promise(() => {}))
    render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('fetches content via getTicketContent with boardId', async () => {
    vi.mocked(getTicketContent).mockResolvedValue('content')
    render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(getTicketContent).toHaveBeenCalledWith('test-board', 'tickets/feat-1.md')
    })
  })

  it('shows content after fetch', async () => {
    vi.mocked(getTicketContent).mockResolvedValue('# Ticket content')
    render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('# Ticket content')).toBeInTheDocument()
    })
  })

  it('falls back to filename when title is null', () => {
    const ticket = { ...baseTicket, title: null }
    render(
      <TicketDetail
        ticket={ticket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('feat-1')).toBeInTheDocument()
  })

  it('shows dash for session when not assigned', () => {
    const ticket = { ...baseTicket, session: null, status: null }
    render(
      <TicketDetail
        ticket={ticket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('calls onClose on close button click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByTestId('icon-close').closest('button'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on backdrop click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={onClose}
      />,
    )

    await user.click(container.querySelector('.ticket-detail-backdrop'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape key', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <TicketDetail
        ticket={baseTicket}
        states={defaultStates}
        swimlanes={defaultSwimlanes}
        onClose={onClose}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })
})
