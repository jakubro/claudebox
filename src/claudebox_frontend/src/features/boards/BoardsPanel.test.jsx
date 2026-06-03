/** Tests for BoardsPanel component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BoardsPanel from './BoardsPanel'

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check">✓</span>,
  Pencil: () => <span data-testid="icon-pencil">✎</span>,
  RefreshCw: () => <span data-testid="refresh-icon">refresh</span>,
  X: () => <span data-testid="icon-x">✕</span>,
}))

// Mock SessionRoutingContext
const mockRouting = { navigateToBoard: vi.fn() }
vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => mockRouting,
}))

// Mock WorkspaceContext
vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'test-ws' }),
}))

// Mock EventsContext for footer status flashing
vi.mock('../../context/EventsContext', () => ({
  useEvents: () => ({
    startOpeningBoard: vi.fn(),
    clearOpeningBoard: vi.fn(),
  }),
}))

// Mock boards API
vi.mock('../../api/boards', () => ({
  renameBoard: vi.fn(),
}))

// Mock useBoardList hook
const mockBoardList = {
  boards: [],
  loading: false,
  error: null,
  refresh: vi.fn(),
}
vi.mock('./hooks/useBoardList', () => ({
  default: () => mockBoardList,
}))

describe('BoardsPanel', () => {
  beforeEach(() => {
    mockBoardList.boards = []
    mockBoardList.loading = false
    mockBoardList.error = null
    mockBoardList.refresh.mockClear()
    mockRouting.navigateToBoard.mockClear()
  })

  it('renders refresh meta-item at the end of the list', () => {
    mockBoardList.boards = [{ id: 'b1', name: 'Board', path: 'board.yaml' }]
    render(<BoardsPanel />)

    expect(screen.getByTestId('boards-refresh-meta')).toBeInTheDocument()
    expect(screen.getByTestId('refresh-icon')).toBeInTheDocument()
    // No dedicated header strip — meta-item replaces the header refresh button.
    expect(document.querySelector('.boards-panel-header')).not.toBeInTheDocument()
  })

  it('does not render a "Boards" header title', () => {
    mockBoardList.boards = [{ id: 'b1', name: 'Board', path: 'board.yaml' }]
    render(<BoardsPanel />)

    expect(screen.queryByText('Boards')).not.toBeInTheDocument()
  })

  it('renders panel-level loading placeholder without spinner', () => {
    mockBoardList.loading = true

    render(<BoardsPanel />)

    const panel = screen.getByTestId('panel-boards')
    expect(panel).toHaveClass('boards-loading')
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByTestId('loader')).not.toBeInTheDocument()
    // No header / refresh button rendered while loading.
    expect(screen.queryByTitle('Refresh')).not.toBeInTheDocument()
  })

  it('renders error state with generic copy and panel-level styling', () => {
    mockBoardList.error = 'Network failure'

    render(<BoardsPanel />)

    // Generic copy hides the raw err.message (e.g. "Workspace ID not set"
    // invariant) from the user.
    expect(screen.getByText('Failed to load boards')).toBeInTheDocument()
    expect(screen.queryByText('Network failure')).not.toBeInTheDocument()
    expect(screen.getByTestId('panel-boards')).toHaveClass('boards-error')
  })

  it('error state for missing workspace surfaces the same generic copy', () => {
    // Mirrors the daemon-level "Workspace ID not set" invariant — the
    // BoardsPanel must render the centered + italic error treatment regardless
    // of the underlying error message. The harness only ships one workspace,
    // so the missing-workspace state is exercised here at the unit level.
    mockBoardList.error = 'Workspace ID not set'

    render(<BoardsPanel />)

    const panel = screen.getByTestId('panel-boards')
    expect(panel).toHaveClass('boards-error')
    expect(screen.getByText('Failed to load boards')).toBeInTheDocument()
  })

  it('does not render the boards list when error is set', () => {
    mockBoardList.error = 'Network failure'
    mockBoardList.boards = [
      { id: 'b1', name: 'Sprint Board', path: '/project/.boards/sprint.yaml' },
    ]

    render(<BoardsPanel />)

    expect(screen.queryByText('Sprint Board')).not.toBeInTheDocument()
  })

  it('renders empty state when no boards and not loading', () => {
    render(<BoardsPanel />)

    expect(screen.getByText('No boards found')).toBeInTheDocument()
  })

  it('does not show empty state when loading', () => {
    mockBoardList.loading = true

    render(<BoardsPanel />)

    // Loading placeholder pre-empts the empty-state copy.
    expect(screen.queryByText('No boards found')).not.toBeInTheDocument()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('does not show empty state when there is an error', () => {
    mockBoardList.error = 'Something went wrong'

    render(<BoardsPanel />)

    expect(screen.queryByText('No boards found')).not.toBeInTheDocument()
  })

  it('renders board items with name and path', () => {
    mockBoardList.boards = [
      { id: 'b1', name: 'Sprint Board', path: '/project/.boards/sprint.yaml' },
      { id: 'b2', name: 'Backlog', path: '/project/.boards/backlog.yaml' },
    ]

    render(<BoardsPanel />)

    expect(screen.getByText('Sprint Board')).toBeInTheDocument()
    expect(screen.getByText('/project/.boards/sprint.yaml')).toBeInTheDocument()
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('/project/.boards/backlog.yaml')).toBeInTheDocument()
  })

  it('navigates to board URL when a board item is clicked', async () => {
    const user = userEvent.setup()
    mockBoardList.boards = [
      { id: 'b1', name: 'Sprint Board', path: '/project/.boards/sprint.yaml' },
    ]

    render(<BoardsPanel />)

    await user.click(screen.getByText('Sprint Board'))

    expect(mockRouting.navigateToBoard).toHaveBeenCalledWith('test-ws', 'b1')
  })

  it('calls refresh when the meta-refresh item is clicked', async () => {
    const user = userEvent.setup()
    mockBoardList.boards = [{ id: 'b1', name: 'Board', path: 'board.yaml' }]

    render(<BoardsPanel />)

    await user.click(screen.getByTestId('boards-refresh-meta'))

    expect(mockBoardList.refresh).toHaveBeenCalled()
  })

  it('shows refresh meta-item also when the board list is empty', () => {
    // Empty state still surfaces the meta-refresh so the user can retry.
    render(<BoardsPanel />)

    expect(screen.getByText('No boards found')).toBeInTheDocument()
    expect(screen.getByTestId('boards-refresh-meta')).toBeInTheDocument()
  })
})
