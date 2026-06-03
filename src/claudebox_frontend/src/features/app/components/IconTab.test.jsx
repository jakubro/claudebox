/** Tests for IconTab component. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import IconTab from './IconTab'

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Archive: () => <span data-testid="icon-stash">📦</span>,
  Command: () => <span data-testid="icon-commands">⌘</span>,
  FileText: () => <span data-testid="icon-file">📄</span>,
  FolderTree: () => <span data-testid="icon-files">📁</span>,
  HelpCircle: () => <span data-testid="icon-help">❓</span>,
  History: () => <span data-testid="icon-sessions">⏰</span>,
  Kanban: () => <span data-testid="icon-boards">📋</span>,
  ListTodo: () => <span data-testid="icon-todos">📋</span>,
  Pin: () => <span data-testid="icon-pin">📌</span>,
  Plug: () => <span data-testid="icon-mcp">🔌</span>,
  SquareKanban: () => <span data-testid="icon-tasks">📊</span>,
  Terminal: () => <span data-testid="icon-logs">💻</span>,
  Bookmark: () => <span data-testid="icon-bookmarks">🔖</span>,
  TrendingUp: () => <span data-testid="icon-usage">📈</span>,
  X: () => <span data-testid="icon-close">✕</span>,
}))

// Mock AppActionsContext
const mockMaximizeToggle = vi.fn()
const mockClosePanel = vi.fn()
vi.mock('../../../context/AppActionsContext', () => ({
  useAppActions: () => ({
    maximizeToggle: mockMaximizeToggle,
    closePanel: mockClosePanel,
  }),
}))

// Mock WorkspaceContext
vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'test-ws' }),
}))

// Mock boards API and navigation utils
vi.mock('../../../api/boards', () => ({
  renameBoard: vi.fn(),
}))

vi.mock('../../../utils/navigation', () => ({
  openBoardInNewTab: vi.fn(),
}))

describe('IconTab', () => {
  const createApi = (id, title = 'Test Tab') => ({
    id,
    title,
    close: vi.fn(),
    group: { api: {} },
    onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
  })

  beforeEach(() => {
    mockMaximizeToggle.mockClear()
    mockClosePanel.mockClear()
  })

  it('renders correct icon for panel type', () => {
    render(<IconTab api={createApi('stash', 'Stash')} />)
    expect(screen.getByTestId('icon-stash')).toBeInTheDocument()
  })

  it('renders SquareKanban icon for tasks panel', () => {
    render(<IconTab api={createApi('tasks', 'Tasks')} />)
    expect(screen.getByTestId('icon-tasks')).toBeInTheDocument()
  })

  it('renders Terminal icon for logs panel', () => {
    render(<IconTab api={createApi('logs', 'Logs')} />)
    expect(screen.getByTestId('icon-logs')).toBeInTheDocument()
  })

  it('renders Command icon for commands panel', () => {
    render(<IconTab api={createApi('commands', 'Skills')} />)
    expect(screen.getByTestId('icon-commands')).toBeInTheDocument()
  })

  it('renders FileText icon for file tabs', () => {
    render(<IconTab api={createApi('file:/path/to/file.js', 'file.js')} />)
    expect(screen.getByTestId('icon-file')).toBeInTheDocument()
  })

  it('renders the close button on every tab', () => {
    render(<IconTab api={createApi('stash', 'Stash')} />)
    expect(screen.getByTestId('icon-close')).toBeInTheDocument()
  })

  it('calls maximizeToggle on double-click', async () => {
    const user = userEvent.setup()
    const api = createApi('stash', 'Stash')
    render(<IconTab api={api} />)

    await user.dblClick(screen.getByText('Stash'))

    expect(mockMaximizeToggle).toHaveBeenCalled()
  })

  it('closes tab on middle-click', () => {
    const api = createApi('stash', 'Stash')
    render(<IconTab api={api} />)

    fireEvent.mouseDown(screen.getByText('Stash'), { button: 1 })

    expect(mockClosePanel).toHaveBeenCalledWith('stash')
  })

  it('closes tab on close button click', async () => {
    const user = userEvent.setup()
    const api = createApi('todos', 'Todos')
    const { container } = render(<IconTab api={api} />)

    await user.click(container.querySelector('.icon-tab-close'))

    expect(mockClosePanel).toHaveBeenCalledWith('todos')
  })

  it('updates rendered title when api title changes', () => {
    const api = createApi('stash', 'Stash')
    // Capture the callback so we can invoke it
    let titleChangeCallback
    api.onDidTitleChange = vi.fn(cb => {
      titleChangeCallback = cb
      return { dispose: vi.fn() }
    })

    render(<IconTab api={api} />)
    expect(screen.getByText('Stash')).toBeInTheDocument()

    // Simulate title change
    api.title = 'Updated'
    act(() => titleChangeCallback())

    expect(screen.getByText('Updated')).toBeInTheDocument()
  })
})
