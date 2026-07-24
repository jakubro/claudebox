/** Tests for TicketCard component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

// Controllable session state for the shared status derivation.
let mockSessions = []
let mockStopping = new Set()

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions }),
}))

vi.mock('../../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    // Mirrors the real deriveSessionStatus: container presence -> running/stopping, else none.
    deriveSessionStatus: (sessionId, sessions = []) => {
      const hasContainer = sessions.some(s => s.session_id === sessionId && s.container_id)
      if (!hasContainer) {
        return 'none'
      }
      return mockStopping.has(sessionId) ? 'stopping' : 'running'
    },
  }),
}))

const baseTicket = {
  path: 'tickets/feat-1.md',
  title: 'Add authentication',
  session: null,
}

const runningSessions = [{ session_id: 'abcd1234efgh', container_id: 'ctr-1' }]

beforeEach(() => {
  mockSessions = []
  mockStopping = new Set()
})

describe('TicketCard', () => {
  it('renders ticket title', () => {
    render(<TicketCard ticket={baseTicket} />)

    expect(screen.getByText('Add authentication')).toBeInTheDocument()
  })

  it('renders session info when ticket has session', () => {
    mockSessions = runningSessions
    const ticket = { ...baseTicket, session: 'abcd1234efgh' }
    render(<TicketCard ticket={ticket} />)

    expect(screen.getByText(/running/)).toBeInTheDocument()
    expect(screen.getByText(/abcd/)).toBeInTheDocument()
  })

  it('does not render session info when no session', () => {
    render(<TicketCard ticket={baseTicket} />)

    expect(screen.queryByText(/running|stopped/)).not.toBeInTheDocument()
  })

  it('shows running status when the session has a live container', () => {
    mockSessions = runningSessions
    const ticket = { ...baseTicket, session: 'abcd1234efgh' }
    const { container } = render(<TicketCard ticket={ticket} />)

    expect(container.querySelector('.ticket-status-dot.running')).toBeInTheDocument()
    expect(screen.getByText(/running \(abcd/)).toBeInTheDocument()
  })

  it('shows stopping status while the session is tearing down', () => {
    mockSessions = runningSessions
    mockStopping = new Set(['abcd1234efgh'])
    const ticket = { ...baseTicket, session: 'abcd1234efgh' }
    const { container } = render(<TicketCard ticket={ticket} />)

    expect(container.querySelector('.ticket-status-dot.stopping')).toBeInTheDocument()
    expect(screen.getByText(/stopping \(abcd/)).toBeInTheDocument()
  })

  it('shows stopped status when the session has no live container', () => {
    // mockSessions empty -> deriveSessionStatus returns 'none' -> gray "stopped".
    const ticket = { ...baseTicket, session: 'abcd1234efgh' }
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
