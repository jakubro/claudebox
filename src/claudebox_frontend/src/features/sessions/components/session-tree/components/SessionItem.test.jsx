/** Tests for SessionItem component. */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SessionItem from './SessionItem'

// Mock ContainerMapContext
vi.mock('../../../../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    stoppingSessions: new Set(),
    deriveSessionStatus: (_sessionId, _sessions, fallbackContainerId = null) =>
      fallbackContainerId ? 'running' : 'none',
  }),
}))

// Mock formatters
vi.mock('../../../../../utils/formatters', () => ({
  formatRelativeTime: ts => (ts ? 'just now' : ''),
  formatAbsoluteTime: ts => (ts ? 'Apr 25, 2026, 7:40 PM' : ''),
  formatTurns: n => (n != null ? `${n} turns` : '0 turns'),
  formatCost: c => (c != null ? `$${c.toFixed(2)}` : '$0.00'),
  formatMessagePreview: msg => {
    if (!msg) {
      return null
    }
    if (msg.startsWith('/')) {
      return msg.split(' ')[0] + (msg.includes(' ') ? ` ${msg.split(' ').slice(1).join(' ')}` : '')
    }
    return msg
  },
}))

// Mock useDropdown
vi.mock('../../../../../hooks/useDropdown', () => ({
  default: () => ({
    isOpen: false,
    setIsOpen: vi.fn(),
    containerRef: { current: null },
    handleToggle: vi.fn(),
    handleKeyDown: vi.fn(),
  }),
}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check">✓</span>,
  Loader2: () => <span data-testid="icon-loader">⟳</span>,
  Pencil: () => <span data-testid="icon-pencil">✏</span>,
  Pin: () => <span data-testid="icon-pin">📌</span>,
  Play: () => <span data-testid="icon-resume">▶</span>,
  Square: () => <span data-testid="icon-square">■</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">▾</span>,
  X: () => <span data-testid="icon-x">×</span>,
}))

describe('SessionItem', () => {
  const createSession = (overrides = {}) => ({
    session_id: 'abc12345-6789-0def-ghij-klmnopqrstuv',
    session_dir: '/tmp/sessions/abc12345-6789-0def-ghij-klmnopqrstuv',
    workspace: '/home/user/project',
    model: 'claude-sonnet-4-20250514',
    name: 'Test Session',
    started_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T12:00:00Z',
    num_turns: 5,
    total_cost_usd: 0.15,
    total_duration_ms: 8000,
    last_context_tokens: 5000,
    first_message: 'Hello world',
    last_message: 'Goodbye world',
    todos: [],
    commands: [],
    parent_session_id: null,
    ...overrides,
  })

  it('renders session ID (first 8 chars) and name', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.getByText('abc12345')).toBeInTheDocument()
    expect(screen.getByText('Test Session')).toBeInTheDocument()
  })

  it('shows time display', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.getByText(/just now/)).toBeInTheDocument()
  })

  it('shows turns and cost metadata', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    // Turns/cost appear in both meta-row and meta-overflow (for responsive layout)
    expect(screen.getAllByText(/5 turns/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\$0\.15/).length).toBeGreaterThan(0)
  })

  it('shows first/last message preview', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.getByText(/"Hello world"/)).toBeInTheDocument()
    expect(screen.getByText(/"...Goodbye world"/)).toBeInTheDocument()
  })

  it('highlights current session', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={true}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    const item = document.querySelector('.sessions-item-current')
    expect(item).toBeInTheDocument()
  })

  it('shows full name in title attribute for tooltip on truncated name', () => {
    const longName = 'A very long session name that would definitely be truncated in the UI'
    render(
      <SessionItem
        session={createSession({ name: longName })}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    const nameSpan = document.querySelector('.sessions-name')
    expect(nameSpan).toHaveAttribute('title', longName)
  })

  it('shows unified Session directory tooltip on ID span', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    const idSpan = document.querySelector('.sessions-id')
    expect(idSpan).toHaveAttribute(
      'title',
      'Session directory - /tmp/sessions/abc12345-6789-0def-ghij-klmnopqrstuv',
    )
  })

  it('copies session dir to clipboard on ID click and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    vi.useFakeTimers()
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    const idSpan = document.querySelector('.sessions-id')
    await act(async () => {
      idSpan.click()
    })

    expect(writeText).toHaveBeenCalledWith('/tmp/sessions/abc12345-6789-0def-ghij-klmnopqrstuv')
    expect(idSpan.textContent).toContain('Copied!')

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(idSpan.textContent).not.toContain('Copied!')
    vi.useRealTimers()
  })

  it('shows resume button for non-current sessions', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.getByTestId('icon-resume')).toBeInTheDocument()
  })

  it('hides resume button for current session', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={true}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('icon-resume')).not.toBeInTheDocument()
  })

  it('enters edit mode on pencil click, keeping rows 2-5 visible', async () => {
    const user = userEvent.setup()
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        isPinned={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle('Rename session'))

    // Row 1: edit input replaces header
    expect(screen.getByPlaceholderText('Session name...')).toBeInTheDocument()
    // Row 2: meta and buttons remain visible
    expect(screen.getByText(/just now/)).toBeInTheDocument()
    expect(screen.getByTestId('icon-pin')).toBeInTheDocument()
    expect(screen.getByTestId('icon-resume')).toBeInTheDocument()
    // Rows 4-5: message previews remain visible
    expect(screen.getByText(/"Hello world"/)).toBeInTheDocument()
    expect(screen.getByText(/"...Goodbye world"/)).toBeInTheDocument()
  })

  it('saves rename on Enter', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={onRename}
      />,
    )

    await user.click(screen.getByTitle('Rename session'))
    const input = screen.getByPlaceholderText('Session name...')
    await user.clear(input)
    await user.type(input, 'New Name{Enter}')

    expect(onRename).toHaveBeenCalledWith('New Name')
  })

  it('cancels rename on Escape', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={onRename}
      />,
    )

    await user.click(screen.getByTitle('Rename session'))
    const input = screen.getByPlaceholderText('Session name...')
    await user.type(input, 'New Name{Escape}')

    // Should exit edit mode without calling onRename
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument()
  })

  it('calls onResume when resume clicked', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={onResume}
        onRename={vi.fn()}
      />,
    )

    await user.click(
      screen.getByTitle('Resume session (Alt+Click or middle-click for new browser tab)'),
    )

    expect(onResume).toHaveBeenCalled()
  })

  it('calls onOpenInNewTab on Alt+Click resume', () => {
    const onResume = vi.fn()
    const onOpenInNewTab = vi.fn()
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={onResume}
        onRename={vi.fn()}
        onOpenInNewTab={onOpenInNewTab}
      />,
    )

    const btn = screen.getByTitle('Resume session (Alt+Click or middle-click for new browser tab)')
    btn.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }))

    expect(onOpenInNewTab).toHaveBeenCalled()
    expect(onResume).not.toHaveBeenCalled()
  })

  it('handles session without name', () => {
    render(
      <SessionItem
        session={createSession({ name: null })}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.getByText('abc12345')).toBeInTheDocument()
    expect(screen.queryByText('Test Session')).not.toBeInTheDocument()
  })

  it('shows pin button for all sessions', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        isPinned={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByTestId('icon-pin')).toBeInTheDocument()
  })

  it('shows pin button for current session too', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={true}
        isPinned={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByTestId('icon-pin')).toBeInTheDocument()
  })

  it('applies pinned class when isPinned=true', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        isPinned={true}
        onResume={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    const pinBtn = screen.getByTestId('session-pin-btn')
    expect(pinBtn).toHaveClass('pinned')
  })

  it('does not apply pinned class when isPinned=false', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        isPinned={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    const pinBtn = screen.getByTestId('session-pin-btn')
    expect(pinBtn).not.toHaveClass('pinned')
  })

  it('calls onTogglePin when pin button clicked', async () => {
    const user = userEvent.setup()
    const onTogglePin = vi.fn()
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        isPinned={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={onTogglePin}
      />,
    )

    await user.click(screen.getByTitle('Pin session'))

    expect(onTogglePin).toHaveBeenCalled()
  })

  it('shows unpin title when pinned', () => {
    render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        isPinned={true}
        onResume={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByTitle('Unpin session')).toBeInTheDocument()
  })

  describe('Kill container button', () => {
    it('shows kill button when session has container_id', () => {
      render(
        <SessionItem
          session={createSession({ container_id: 'ctr-123' })}
          isCurrent={false}
          isPinned={false}
          onResume={vi.fn()}
          onRename={vi.fn()}
          onTogglePin={vi.fn()}
          onKillContainer={vi.fn()}
        />,
      )

      expect(screen.getByTestId('session-kill-btn')).toBeInTheDocument()
    })

    it('hides kill button when session has no container_id', () => {
      render(
        <SessionItem
          session={createSession({ container_id: null })}
          isCurrent={false}
          isPinned={false}
          onResume={vi.fn()}
          onRename={vi.fn()}
          onTogglePin={vi.fn()}
          onKillContainer={vi.fn()}
        />,
      )

      expect(screen.queryByTestId('session-kill-btn')).not.toBeInTheDocument()
    })

    it('calls onKillContainer when kill button clicked', async () => {
      const user = userEvent.setup()
      const onKillContainer = vi.fn()
      render(
        <SessionItem
          session={createSession({ container_id: 'ctr-123' })}
          isCurrent={false}
          isPinned={false}
          onResume={vi.fn()}
          onRename={vi.fn()}
          onTogglePin={vi.fn()}
          onKillContainer={onKillContainer}
        />,
      )

      await user.click(screen.getByTitle('Stop container'))

      expect(onKillContainer).toHaveBeenCalled()
    })
  })

  describe('Save/Cancel button clicks', () => {
    it('saves rename when Save button is clicked', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      render(
        <SessionItem
          session={createSession()}
          isCurrent={false}
          onResume={vi.fn()}
          onRename={onRename}
        />,
      )

      // Enter edit mode
      await user.click(screen.getByTitle('Rename session'))
      const input = screen.getByPlaceholderText('Session name...')
      await user.clear(input)
      await user.type(input, 'Button Save Name')

      // Click Save button
      await user.click(screen.getByTitle('Save'))

      expect(onRename).toHaveBeenCalledWith('Button Save Name')
      // Should exit edit mode
      expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument()
    })

    it('cancels rename when Cancel button is clicked', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      render(
        <SessionItem
          session={createSession()}
          isCurrent={false}
          onResume={vi.fn()}
          onRename={onRename}
        />,
      )

      // Enter edit mode
      await user.click(screen.getByTitle('Rename session'))
      const input = screen.getByPlaceholderText('Session name...')
      await user.type(input, 'Should Not Save')

      // Click Cancel button
      await user.click(screen.getByTitle('Cancel'))

      expect(onRename).not.toHaveBeenCalled()
      // Should exit edit mode
      expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument()
    })
  })

  describe('mobile branch (isMobile=true)', () => {
    it('hides pin, kill, and resume split-button', () => {
      render(
        <SessionItem
          isMobile
          session={createSession({ container_id: 'c-1' })}
          isCurrent={false}
          onResume={vi.fn()}
          onRename={vi.fn()}
        />,
      )

      expect(screen.queryByTestId('session-pin-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('session-kill-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('session-resume-btn')).not.toBeInTheDocument()
    })

    it('outer-card click calls onResume for non-current session', async () => {
      const user = userEvent.setup()
      const onResume = vi.fn()
      render(
        <SessionItem
          isMobile
          session={createSession()}
          isCurrent={false}
          onResume={onResume}
          onRename={vi.fn()}
        />,
      )

      await user.click(screen.getByTestId('session-item'))

      expect(onResume).toHaveBeenCalledOnce()
    })

    it('outer-card click calls onClose for current session, no resume', async () => {
      const user = userEvent.setup()
      const onResume = vi.fn()
      const onClose = vi.fn()
      render(
        <SessionItem
          isMobile
          session={createSession()}
          isCurrent
          onResume={onResume}
          onRename={vi.fn()}
          onClose={onClose}
        />,
      )

      await user.click(screen.getByTestId('session-item'))

      expect(onClose).toHaveBeenCalledOnce()
      expect(onResume).not.toHaveBeenCalled()
    })

    it('edit pencil click stops propagation to the outer-card click', async () => {
      const user = userEvent.setup()
      const onResume = vi.fn()
      render(
        <SessionItem
          isMobile
          session={createSession()}
          isCurrent={false}
          onResume={onResume}
          onRename={vi.fn()}
        />,
      )

      await user.click(screen.getByTitle('Rename session'))

      // Pencil click entered edit mode; outer-card resume did NOT fire.
      expect(screen.getByPlaceholderText('Session name...')).toBeInTheDocument()
      expect(onResume).not.toHaveBeenCalled()
    })

    it('outer card exposes role=button when mobile and not editing', () => {
      render(
        <SessionItem
          isMobile
          session={createSession()}
          isCurrent={false}
          onResume={vi.fn()}
          onRename={vi.fn()}
        />,
      )

      const card = screen.getByTestId('session-item')
      expect(card).toHaveAttribute('role', 'button')
      expect(card).toHaveAttribute('tabindex', '0')
    })
  })
})
