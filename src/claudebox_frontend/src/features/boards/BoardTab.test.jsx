/** Tests for BoardTab - board state, column/swimlane rendering, and drag-and-drop handlers. */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveTicket,
  assignTickets,
  moveTicket,
  reorderStates,
  reorderSwimlanes,
} from '../../api/boards'
import BoardTab from './BoardTab'

vi.mock('lucide-react', () => ({
  Loader2: () => <span data-testid="loader-icon" />,
}))

vi.mock('../../api/boards', () => ({
  archiveTicket: vi.fn(),
  assignTickets: vi.fn(),
  moveTicket: vi.fn(),
  reorderStates: vi.fn(),
  reorderSwimlanes: vi.fn(),
}))

vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ density: 'comfortable' }),
}))

let capturedDnd = null
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual('@dnd-kit/core')
  return {
    ...actual,
    DndContext: props => {
      capturedDnd = props
      return props.children
    },
    DragOverlay: props => props.children,
  }
})

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }) => children,
  horizontalListSortingStrategy: {},
  verticalListSortingStrategy: {},
}))

vi.mock('./components/BoardControlBar', () => ({
  default: () => <div data-testid="control-bar" />,
}))

vi.mock('./components/AddSwimlaneRow', () => ({
  default: () => <div data-testid="add-swimlane-row" />,
}))

vi.mock('./components/TicketCard', () => ({
  default: ({ ticket, isDragOverlay }) => (
    <div data-testid="drag-overlay-ticket" data-overlay={!!isDragOverlay}>
      {ticket.title}
    </div>
  ),
}))

vi.mock('./components/TicketDetail', () => ({
  default: ({ ticket, onClose }) => (
    <div data-testid="ticket-detail">
      <span>{ticket.title}</span>
      <button type="button" data-testid="close-detail" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))

vi.mock('./components/SortableColumnHeader', () => ({
  default: ({ col, label, collapsed, onToggle, onContextMenu }) => (
    <div data-testid={`col-header-${col}`}>
      <span>{label}</span>
      <button type="button" data-testid={`toggle-col-${col}`} onClick={() => onToggle(col)}>
        toggle
      </button>
      <button type="button" data-testid={`ctx-col-${col}`} onClick={e => onContextMenu(e, col)}>
        ctx
      </button>
      {collapsed && <span data-testid={`collapsed-${col}`} />}
    </div>
  ),
}))

vi.mock('./components/SwimlaneBand', () => ({
  default: ({ lane, children, onToggleCollapse, collapsed }) => (
    <div data-testid={`lane-${lane.id}`} data-collapsed={!!collapsed}>
      <button
        type="button"
        data-testid={`toggle-lane-${lane.id}`}
        onClick={() => onToggleCollapse(lane.id)}>
        {lane.name}
      </button>
      {children}
    </div>
  ),
}))

vi.mock('./components/BoardColumn', () => ({
  default: ({
    columnKey,
    swimlaneId,
    tickets,
    selectedTickets,
    onToggleSelect,
    onClickTicket,
    onArchive,
    onArchiveCell,
  }) => (
    <div data-testid={`col-${columnKey}-${swimlaneId}`}>
      {tickets.map(t => (
        <div key={t.path}>
          <button type="button" data-testid={`ticket-${t.path}`} onClick={() => onClickTicket(t)}>
            {t.title}
          </button>
          <button
            type="button"
            data-testid={`select-${t.path}`}
            data-selected={selectedTickets.has(t.path)}
            onClick={e => onToggleSelect(t.path, e)}>
            select
          </button>
          <button
            type="button"
            data-testid={`checkbox-${t.path}`}
            onClick={() => onToggleSelect(t.path)}>
            checkbox
          </button>
          <button type="button" data-testid={`archive-${t.path}`} onClick={() => onArchive(t.path)}>
            archive
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid={`archive-cell-${columnKey}-${swimlaneId}`}
        onClick={() => onArchiveCell(tickets)}>
        archive cell
      </button>
    </div>
  ),
}))

const mockBoardData = { board: null, loading: false, error: null, refresh: vi.fn() }
vi.mock('./hooks/useBoardData', () => ({ default: () => mockBoardData }))

const ticketA = { path: 'tickets/a.md', title: 'Ticket A', swimlane: 'lane-1' }
const ticketB = { path: 'tickets/b.md', title: 'Ticket B', swimlane: 'lane-2' }
const ticketD = { path: 'tickets/d.md', title: 'Ticket D' }
const ticketC = {
  path: 'tickets/c.md',
  title: 'Ticket C',
  swimlane: 'lane-1',
  session: 'sess-1',
}

const board = {
  id: 'board-1',
  states: [
    { id: 'backlog', label: 'Backlog', terminal: false, active: false },
    { id: 'doing', label: 'Doing', terminal: false, active: true },
    { id: 'done', label: 'Done', terminal: true, active: false },
  ],
  swimlanes: [
    { id: 'lane-1', name: 'Frontend' },
    { id: 'lane-2', name: 'Backend' },
  ],
  columns: {
    backlog: [ticketA, ticketB, ticketD],
    doing: [ticketC],
    done: [],
  },
}

describe('BoardTab', () => {
  beforeEach(() => {
    capturedDnd = null
    mockBoardData.board = null
    mockBoardData.loading = false
    mockBoardData.error = null
    mockBoardData.refresh.mockClear()
    archiveTicket.mockReset().mockResolvedValue(undefined)
    assignTickets.mockReset().mockResolvedValue(undefined)
    moveTicket.mockReset().mockResolvedValue(undefined)
    reorderStates.mockReset().mockResolvedValue(undefined)
    reorderSwimlanes.mockReset().mockResolvedValue(undefined)
  })

  it('renders the loading placeholder while fetching', () => {
    mockBoardData.loading = true
    render(<BoardTab boardId="board-1" />)

    expect(screen.getByText('Loading board...')).toBeInTheDocument()
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument()
  })

  it('renders a parse error', () => {
    mockBoardData.error = 'invalid yaml'
    render(<BoardTab boardId="board-1" />)

    expect(screen.getByText('Failed to parse board.yaml: invalid yaml')).toBeInTheDocument()
  })

  it('renders nothing when there is no board, no error, and not loading', () => {
    const { container } = render(<BoardTab boardId="board-1" />)

    expect(container.firstChild).toBeNull()
  })

  it('renders columns, known swimlanes, and the unsorted lane with correctly filtered tickets', () => {
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('Doing')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByTestId('lane-lane-1')).toBeInTheDocument()
    expect(screen.getByTestId('lane-lane-2')).toBeInTheDocument()
    expect(screen.getByTestId('lane-__unsorted__')).toBeInTheDocument()

    // lane-1's backlog cell only carries the ticket assigned to lane-1.
    expect(
      screen.getByTestId('col-backlog-lane-1').querySelector('[data-testid="ticket-tickets/a.md"]'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('col-backlog-lane-1').querySelector('[data-testid="ticket-tickets/b.md"]'),
    ).not.toBeInTheDocument()

    // The unsorted lane only carries the ticket with no (or unknown) swimlane.
    expect(
      screen
        .getByTestId('col-backlog-__unsorted__')
        .querySelector('[data-testid="ticket-tickets/d.md"]'),
    ).toBeInTheDocument()
    expect(
      screen
        .getByTestId('col-backlog-__unsorted__')
        .querySelector('[data-testid="ticket-tickets/a.md"]'),
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('add-swimlane-row')).toBeInTheDocument()
  })

  it('collapses terminal columns by default via the board-identity effect', () => {
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    expect(screen.getByTestId('collapsed-done')).toBeInTheDocument()
    expect(screen.queryByTestId('collapsed-backlog')).not.toBeInTheDocument()

    const grid = document.querySelector('.board-board')
    expect(grid.style.gridTemplateColumns).toBe('minmax(200px, 1fr) minmax(200px, 1fr) 32px')
  })

  it('toggles a column collapsed state and updates the grid template', async () => {
    const user = userEvent.setup()
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    await user.click(screen.getByTestId('toggle-col-backlog'))

    expect(screen.getByTestId('collapsed-backlog')).toBeInTheDocument()
    const grid = document.querySelector('.board-board')
    expect(grid.style.gridTemplateColumns).toBe('32px minmax(200px, 1fr) 32px')
  })

  it('opens a ticket detail overlay on click and closes it', async () => {
    const user = userEvent.setup()
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    await user.click(screen.getByTestId('ticket-tickets/a.md'))
    expect(screen.getByTestId('ticket-detail')).toBeInTheDocument()
    expect(screen.getAllByText('Ticket A').length).toBeGreaterThan(0)

    await user.click(screen.getByTestId('close-detail'))
    expect(screen.queryByTestId('ticket-detail')).not.toBeInTheDocument()
  })

  it('single click selection replaces the previous selection', async () => {
    const user = userEvent.setup()
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    await user.click(screen.getByTestId('select-tickets/a.md'))
    expect(screen.getByTestId('select-tickets/a.md')).toHaveAttribute('data-selected', 'true')

    await user.click(screen.getByTestId('select-tickets/b.md'))
    expect(screen.getByTestId('select-tickets/b.md')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('select-tickets/a.md')).toHaveAttribute('data-selected', 'false')
  })

  it('ctrl-click selection accumulates multiple tickets', async () => {
    const user = userEvent.setup()
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    await user.click(screen.getByTestId('select-tickets/a.md'))
    await user.keyboard('{Control>}')
    await user.click(screen.getByTestId('select-tickets/b.md'))
    await user.keyboard('{/Control}')

    expect(screen.getByTestId('select-tickets/a.md')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('select-tickets/b.md')).toHaveAttribute('data-selected', 'true')
  })

  it('checkbox-style toggle (no event) preserves the existing selection', async () => {
    const user = userEvent.setup()
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    await user.click(screen.getByTestId('checkbox-tickets/a.md'))
    await user.click(screen.getByTestId('checkbox-tickets/b.md'))

    expect(screen.getByTestId('select-tickets/a.md')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('select-tickets/b.md')).toHaveAttribute('data-selected', 'true')
  })

  it('shows the dragged ticket in the drag overlay once a drag starts', async () => {
    mockBoardData.board = board
    render(<BoardTab boardId="board-1" />)

    expect(screen.queryByTestId('drag-overlay-ticket')).not.toBeInTheDocument()

    await act(async () => {
      capturedDnd.onDragStart({ active: { id: 'tickets/a.md' } })
    })

    expect(screen.getByTestId('drag-overlay-ticket')).toHaveTextContent('Ticket A')
  })

  describe('column context menu', () => {
    it('shows boundary-disabled move buttons and the correct archive count', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('ctx-col-backlog'))

      expect(screen.getByText('Move left')).toBeDisabled()
      expect(screen.getByText('Move right')).not.toBeDisabled()
      expect(
        screen.getByText('Archive all tickets in Backlog state (3 tickets)'),
      ).toBeInTheDocument()
    })

    it('disables archive when the column has no tickets', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('ctx-col-done'))

      expect(screen.getByText('Move right')).toBeDisabled()
      expect(screen.getByText('Archive all tickets in Done state (0 tickets)')).toBeDisabled()
    })

    it('closes on backdrop click', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('ctx-col-backlog'))
      expect(screen.getByText('Move left')).toBeInTheDocument()

      await user.click(document.querySelector('.swimlane-context-backdrop'))
      expect(screen.queryByText('Move left')).not.toBeInTheDocument()
    })

    it('moves a column right and refreshes', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('ctx-col-backlog'))
      await user.click(screen.getByText('Move right'))

      expect(reorderStates).toHaveBeenCalledWith('board-1', ['doing', 'backlog', 'done'])
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })

    it('logs and does not refresh when reordering columns fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      reorderStates.mockRejectedValueOnce(new Error('boom'))
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('ctx-col-backlog'))
      await user.click(screen.getByText('Move right'))

      expect(consoleSpy).toHaveBeenCalledWith('Failed to reorder columns:', expect.any(Error))
      expect(mockBoardData.refresh).not.toHaveBeenCalled()
    })

    it('bulk-archives every ticket in a column and refreshes', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('ctx-col-backlog'))
      await user.click(screen.getByText('Archive all tickets in Backlog state (3 tickets)'))

      expect(archiveTicket).toHaveBeenCalledTimes(3)
      expect(archiveTicket).toHaveBeenCalledWith('board-1', 'tickets/a.md')
      expect(archiveTicket).toHaveBeenCalledWith('board-1', 'tickets/b.md')
      expect(archiveTicket).toHaveBeenCalledWith('board-1', 'tickets/d.md')
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })
  })

  describe('per-ticket archive', () => {
    it('archives a single ticket and refreshes', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('archive-tickets/a.md'))

      expect(archiveTicket).toHaveBeenCalledWith('board-1', 'tickets/a.md')
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })

    it('logs when archiving a single ticket fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      archiveTicket.mockRejectedValueOnce(new Error('boom'))
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('archive-tickets/a.md'))

      expect(consoleSpy).toHaveBeenCalledWith('Failed to archive ticket:', expect.any(Error))
    })

    it('bulk-archives a cell and refreshes', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('archive-cell-backlog-lane-1'))

      expect(archiveTicket).toHaveBeenCalledWith('board-1', 'tickets/a.md')
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })

    it('no-ops a cell archive with an empty ticket list', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('archive-cell-done-lane-1'))

      expect(archiveTicket).not.toHaveBeenCalled()
      expect(mockBoardData.refresh).not.toHaveBeenCalled()
    })

    it('logs when bulk cell archive fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      archiveTicket.mockRejectedValueOnce(new Error('boom'))
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('archive-cell-backlog-lane-1'))

      expect(consoleSpy).toHaveBeenCalledWith('Failed to bulk archive cell:', expect.any(Error))
    })
  })

  describe('handleDragEnd', () => {
    it('is a no-op when there is no drop target', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({ active: { id: 'tickets/a.md' }, over: null })
      })

      expect(moveTicket).not.toHaveBeenCalled()
    })

    it('is a no-op when the dragged id has no matching ticket', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/missing.md' },
          over: { id: 'col-header:doing' },
        })
      })

      expect(moveTicket).not.toHaveBeenCalled()
    })

    it('reorders columns via header-to-header drop', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'col-header:backlog' },
          over: { id: 'col-header:done' },
        })
      })

      expect(reorderStates).toHaveBeenCalledWith('board-1', ['doing', 'done', 'backlog'])
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })

    it('is a no-op dropping a column header onto itself', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'col-header:backlog' },
          over: { id: 'col-header:backlog' },
        })
      })

      expect(reorderStates).not.toHaveBeenCalled()
    })

    it('logs when column header reorder fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      reorderStates.mockRejectedValueOnce(new Error('boom'))
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'col-header:backlog' },
          over: { id: 'col-header:done' },
        })
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to reorder columns:', expect.any(Error))
    })

    it('reorders swimlanes via header-to-header drop', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'lane-header:lane-1' },
          over: { id: 'lane-header:lane-2' },
        })
      })

      expect(reorderSwimlanes).toHaveBeenCalledWith('board-1', ['lane-2', 'lane-1'])
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })

    it('is a no-op dropping a swimlane header onto itself', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'lane-header:lane-1' },
          over: { id: 'lane-header:lane-1' },
        })
      })

      expect(reorderSwimlanes).not.toHaveBeenCalled()
    })

    it('logs when swimlane header reorder fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      reorderSwimlanes.mockRejectedValueOnce(new Error('boom'))
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'lane-header:lane-1' },
          over: { id: 'lane-header:lane-2' },
        })
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to reorder swimlanes:', expect.any(Error))
    })

    it('moves a ticket onto a column header and auto-assigns it (active column, no session)', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/a.md' },
          over: { id: 'col-header:doing' },
        })
      })

      expect(moveTicket).toHaveBeenCalledWith('board-1', 'tickets/a.md', {
        column: 'doing',
        swimlane: undefined,
        index: undefined,
      })
      expect(assignTickets).toHaveBeenCalledWith('board-1', ['tickets/a.md'])
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })

    it('moves a ticket onto a bare column droppable (col: prefix)', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/a.md' },
          over: { id: 'col:doing' },
        })
      })

      expect(moveTicket).toHaveBeenCalledWith('board-1', 'tickets/a.md', {
        column: 'doing',
        swimlane: undefined,
        index: undefined,
      })
    })

    it('moves a ticket onto a cell (column::swimlane) without auto-assigning a non-active column', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/a.md' },
          over: { id: 'backlog::lane-2' },
        })
      })

      expect(moveTicket).toHaveBeenCalledWith('board-1', 'tickets/a.md', {
        column: undefined,
        swimlane: 'lane-2',
        index: undefined,
      })
      expect(assignTickets).not.toHaveBeenCalled()
    })

    it('moves a ticket by dropping it onto another ticket, computing a drop index', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/a.md' },
          over: { id: 'tickets/c.md' },
        })
      })

      expect(moveTicket).toHaveBeenCalled()
      const [calledBoardId, calledPath, calledBody] = moveTicket.mock.calls[0]
      expect(calledBoardId).toBe('board-1')
      expect(calledPath).toBe('tickets/a.md')
      expect(calledBody.column).toBe('doing')
      // Same origin/target lane ('lane-1') - only the column changes, so swimlane is omitted.
      expect(calledBody.swimlane).toBeUndefined()
      expect(typeof calledBody.index).toBe('number')
    })

    it('does not auto-assign a single ticket that already owns a session', async () => {
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/c.md' },
          over: { id: 'col-header:backlog' },
        })
      })

      expect(assignTickets).not.toHaveBeenCalled()
    })

    it('logs when moving a ticket fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      moveTicket.mockRejectedValueOnce(new Error('boom'))
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/a.md' },
          over: { id: 'col-header:doing' },
        })
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to move ticket:', expect.any(Error))
    })

    it('logs but still refreshes when auto-assign fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      assignTickets.mockRejectedValueOnce(new Error('boom'))
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/a.md' },
          over: { id: 'col-header:doing' },
        })
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to auto-assign ticket:', expect.any(Error))
      expect(mockBoardData.refresh).toHaveBeenCalled()
    })

    it('bulk-moves every selected ticket and preserves origin lanes across a cross-lane drop', async () => {
      const user = userEvent.setup()
      mockBoardData.board = board
      render(<BoardTab boardId="board-1" />)

      await user.click(screen.getByTestId('checkbox-tickets/a.md'))
      await user.click(screen.getByTestId('checkbox-tickets/b.md'))

      await act(async () => {
        await capturedDnd.onDragEnd({
          active: { id: 'tickets/a.md' },
          over: { id: 'doing::lane-1' },
        })
      })

      expect(moveTicket).toHaveBeenCalledTimes(2)
      const paths = moveTicket.mock.calls.map(call => call[1])
      expect(paths.sort()).toEqual(['tickets/a.md', 'tickets/b.md'])
      // Cross-lane bulk move: swimlane is never overwritten, only column.
      for (const call of moveTicket.mock.calls) {
        expect(call[2].swimlane).toBeUndefined()
        expect(call[2].column).toBe('doing')
      }
      expect(assignTickets).toHaveBeenCalledWith('board-1', ['tickets/a.md', 'tickets/b.md'], {
        parallel: false,
      })
    })
  })
})
