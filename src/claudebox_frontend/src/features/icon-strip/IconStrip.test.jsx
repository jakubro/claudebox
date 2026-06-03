/** Tests for IconStrip component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IconStrip from './IconStrip'

// Mock lucide-react (icons without data-testid as component adds its own)
vi.mock('lucide-react', () => ({
  Archive: () => <span>📦</span>,
  Bookmark: () => <span>🔖</span>,
  Box: () => <span>📥</span>,
  Command: () => <span>⌘</span>,
  HelpCircle: () => <span>❓</span>,
  History: () => <span>⏰</span>,
  Kanban: () => <span>📋</span>,
  ListTodo: () => <span>📋</span>,
  Network: () => <span>🌐</span>,
  Plug: () => <span>🔌</span>,
  SquareKanban: () => <span>📊</span>,
  Terminal: () => <span>💻</span>,
  TrendingUp: () => <span>📈</span>,
}))

// Mock useBadgeCounts
const mockBadgeCounts = {
  todoCount: 0,
  stashCount: 0,
  taskCount: 0,
  mcpFailedCount: 0,
  logsHasErrors: false,
}

vi.mock('./hooks/useBadgeCounts', () => ({
  default: () => mockBadgeCounts,
}))

// Mock BottomPanelsContext — IconStrip registers bottomPanels with the
// context on mount.
vi.mock('../../context/BottomPanelsContext', () => ({
  useBottomPanels: () => ({
    registerBottomPanel: vi.fn(),
    unregisterBottomPanel: vi.fn(),
  }),
}))

describe('IconStrip', () => {
  beforeEach(() => {
    mockBadgeCounts.todoCount = 0
    mockBadgeCounts.stashCount = 0
    mockBadgeCounts.taskCount = 0
    mockBadgeCounts.mcpFailedCount = 0
    mockBadgeCounts.logsHasErrors = false
  })

  it('renders panel buttons with icons', () => {
    render(<IconStrip panels={['sessions', 'todos', 'stash', 'help']} onTogglePanel={vi.fn()} />)

    expect(screen.getByTestId('icon-sessions')).toBeInTheDocument()
    expect(screen.getByTestId('icon-todos')).toBeInTheDocument()
    expect(screen.getByTestId('icon-stash')).toBeInTheDocument()
    expect(screen.getByTestId('icon-help')).toBeInTheDocument()
  })

  it('shows badge count for todos and stash', () => {
    mockBadgeCounts.todoCount = 3
    mockBadgeCounts.stashCount = 2

    render(<IconStrip panels={['todos', 'stash']} onTogglePanel={vi.fn()} />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calls onTogglePanel when button clicked', async () => {
    const user = userEvent.setup()
    const onTogglePanel = vi.fn()

    render(<IconStrip panels={['sessions']} onTogglePanel={onTogglePanel} />)

    await user.click(screen.getByTitle('Sessions (Alt+1)'))

    expect(onTogglePanel).toHaveBeenCalledWith('sessions')
  })

  it('highlights active panels', () => {
    render(
      <IconStrip
        panels={['sessions', 'todos']}
        onTogglePanel={vi.fn()}
        activePanels={['sessions']}
      />,
    )

    const sessionsBtn = screen.getByTitle('Sessions (Alt+1)')
    const todosBtn = screen.getByTitle('Todos (Alt+2)')

    expect(sessionsBtn).toHaveClass('active')
    expect(todosBtn).not.toHaveClass('active')
  })

  it('shows tooltip with shortcut', () => {
    render(<IconStrip panels={['sessions']} onTogglePanel={vi.fn()} />)

    expect(screen.getByTitle('Sessions (Alt+1)')).toBeInTheDocument()
  })

  it('does not show badge when count is 0', () => {
    mockBadgeCounts.todoCount = 0

    render(<IconStrip panels={['todos']} onTogglePanel={vi.fn()} />)

    expect(document.querySelector('.icon-badge')).not.toBeInTheDocument()
  })

  it('shows badge for tasks count in default style', () => {
    mockBadgeCounts.taskCount = 4

    render(<IconStrip panels={['tasks']} onTogglePanel={vi.fn()} />)

    const badge = document.querySelector('.icon-badge')
    expect(badge).toHaveTextContent('4')
    expect(badge).not.toHaveClass('icon-badge-danger')
  })

  it('shows badge for failed MCP servers in danger (red) style', () => {
    mockBadgeCounts.mcpFailedCount = 1

    render(<IconStrip panels={['mcp']} onTogglePanel={vi.fn()} />)

    const badge = document.querySelector('.icon-badge')
    expect(badge).toHaveTextContent('1')
    expect(badge).toHaveClass('icon-badge-danger')
  })

  it('hides task and mcp badges when their counts are zero', () => {
    mockBadgeCounts.taskCount = 0
    mockBadgeCounts.mcpFailedCount = 0

    render(<IconStrip panels={['tasks', 'mcp']} onTogglePanel={vi.fn()} />)

    expect(document.querySelector('.icon-badge')).not.toBeInTheDocument()
  })
})

describe('IconStrip position prop', () => {
  beforeEach(() => {
    mockBadgeCounts.todoCount = 0
    mockBadgeCounts.stashCount = 0
  })

  it('applies icon-strip-right class when position is "right"', () => {
    const { container } = render(
      <IconStrip position="right" panels={['sessions']} onTogglePanel={vi.fn()} />,
    )

    const strip = container.querySelector('.icon-strip')
    expect(strip).toHaveClass('icon-strip-right')
    expect(strip).not.toHaveClass('icon-strip-left')
  })

  it('applies icon-strip-left class when position is "left"', () => {
    const { container } = render(
      <IconStrip position="left" panels={['sessions']} onTogglePanel={vi.fn()} />,
    )

    const strip = container.querySelector('.icon-strip')
    expect(strip).toHaveClass('icon-strip-left')
    expect(strip).not.toHaveClass('icon-strip-right')
  })

  it('defaults to icon-strip-right when no position prop', () => {
    const { container } = render(<IconStrip panels={['sessions']} onTogglePanel={vi.fn()} />)

    const strip = container.querySelector('.icon-strip')
    expect(strip).toHaveClass('icon-strip-right')
  })
})

describe('IconStrip unknown panel ID', () => {
  beforeEach(() => {
    mockBadgeCounts.todoCount = 0
    mockBadgeCounts.stashCount = 0
  })

  it('does not render a button for unknown panel IDs', () => {
    render(<IconStrip panels={['sessions', 'nonexistent-panel']} onTogglePanel={vi.fn()} />)

    expect(screen.getByTestId('icon-sessions')).toBeInTheDocument()
    expect(screen.queryByTestId('icon-nonexistent-panel')).not.toBeInTheDocument()
  })

  it('renders nothing when all panel IDs are unknown', () => {
    const { container } = render(
      <IconStrip panels={['unknown1', 'unknown2']} onTogglePanel={vi.fn()} />,
    )

    const buttons = container.querySelectorAll('.icon-btn')
    expect(buttons).toHaveLength(0)
  })
})
