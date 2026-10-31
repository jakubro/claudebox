/** Tests for SessionItem component. */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SessionItem from './SessionItem'

let realRelativeTime = false
vi.mock('../../../../../utils/formatters', async importOriginal => {
  const actual = await importOriginal()
  return {
    formatRelativeTime: (ts, now) =>
      realRelativeTime ? actual.formatRelativeTime(ts, now) : ts ? 'just now' : '',
    formatAbsoluteTime: ts => (ts ? 'Apr 25, 2026, 7:40 PM' : ''),
    formatTurns: n => (n != null ? `${n} turns` : '0 turns'),
    formatCost: c => (c != null ? `$${c.toFixed(2)}` : '$0.00'),
    formatMessagePreview: msg => {
      if (!msg) {
        return null
      }
      if (msg.startsWith('/')) {
        return (
          msg.split(' ')[0] + (msg.includes(' ') ? ` ${msg.split(' ').slice(1).join(' ')}` : '')
        )
      }
      return msg
    },
  }
})

vi.mock('../../../../../hooks/useDropdown', () => ({
  default: () => ({
    isOpen: false,
    setIsOpen: vi.fn(),
    containerRef: { current: null },
    handleToggle: vi.fn(),
    handleKeyDown: vi.fn(),
  }),
}))

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
    model: 'claude-sonnet-5',
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

  function renderItem(props = {}) {
    return render(
      <SessionItem
        session={createSession()}
        isCurrent={false}
        onResume={vi.fn()}
        onRename={vi.fn()}
        {...props}
      />,
    )
  }

  async function startRename() {
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

    return { user, onRename }
  }

  it('renders session ID (first 8 chars) and name', () => {
    renderItem()

    expect(screen.getByText('abc12345')).toBeInTheDocument()
    expect(screen.getByText('Test Session')).toBeInTheDocument()
  })

  it('shows time display', () => {
    renderItem()

    expect(screen.getByText(/just now/)).toBeInTheDocument()
  })

  it('shows turns and cost metadata', () => {
    renderItem()

    // Turns/cost appear in both meta-row and meta-overflow (for responsive layout)
    expect(screen.getAllByText(/5 turns/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\$0\.15/).length).toBeGreaterThan(0)
  })

  it('shows a runtime badge when the session has one', () => {
    renderItem({ session: createSession({ runtime: 'LangGraph' }) })

    // Appears in both meta-row and meta-overflow, same responsive pattern as turns/cost.
    expect(screen.getAllByText('LangGraph').length).toBeGreaterThan(0)
  })

  it('omits the runtime badge for a session with no runtime recorded', () => {
    renderItem()

    expect(screen.queryByTestId('sessions-runtime-badge')).not.toBeInTheDocument()
  })

  it('shows first/last message preview', () => {
    renderItem()

    expect(screen.getByText(/"Hello world"/)).toBeInTheDocument()
    expect(screen.getByText(/"...Goodbye world"/)).toBeInTheDocument()
  })

  it('shows no last-message preview when the session has no last message', () => {
    const { container } = renderItem({ session: createSession({ last_message: null }) })

    expect(screen.getByText(/"Hello world"/)).toBeInTheDocument()
    expect(container.querySelector('.sessions-last span')).toBeNull()
  })

  it('highlights current session', () => {
    renderItem({ isCurrent: true })

    const item = document.querySelector('.sessions-item-current')
    expect(item).toBeInTheDocument()
  })

  it('shows full name in title attribute for tooltip on truncated name', () => {
    const longName = 'A very long session name that would definitely be truncated in the UI'
    renderItem({ session: createSession({ name: longName }) })

    const nameSpan = document.querySelector('.sessions-name')
    expect(nameSpan).toHaveAttribute('title', longName)
  })

  it('shows unified Session directory tooltip on ID span', () => {
    renderItem()

    const idSpan = document.querySelector('.sessions-id')
    expect(idSpan).toHaveAttribute(
      'title',
      'Session directory — /tmp/sessions/abc12345-6789-0def-ghij-klmnopqrstuv',
    )
  })

  it('copies session dir to clipboard on ID click and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    vi.useFakeTimers()
    renderItem()

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
    renderItem()

    expect(screen.getByTestId('icon-resume')).toBeInTheDocument()
  })

  it('hides resume button for current session', () => {
    renderItem({ isCurrent: true })

    expect(screen.queryByTestId('icon-resume')).not.toBeInTheDocument()
  })

  it('enters edit mode on pencil click, keeping rows 2-5 visible', async () => {
    const user = userEvent.setup()
    renderItem({ isPinned: false, actions: { onTogglePin: vi.fn() } })

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
    const { user, onRename } = await startRename()
    const input = screen.getByPlaceholderText('Session name...')
    await user.clear(input)
    await user.type(input, 'New Name{Enter}')

    expect(onRename).toHaveBeenCalledWith('New Name')
  })

  it('cancels rename on Escape', async () => {
    const { user, onRename } = await startRename()
    const input = screen.getByPlaceholderText('Session name...')
    await user.type(input, 'New Name{Escape}')

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument()
  })

  it('calls onResume when resume clicked', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    renderItem({ onResume })

    await user.click(
      screen.getByTitle('Resume session (Alt+Click or middle-click for new browser tab)'),
    )

    expect(onResume).toHaveBeenCalled()
  })

  it('calls onOpenInNewTab on Alt+Click resume', () => {
    const onResume = vi.fn()
    const onOpenInNewTab = vi.fn()
    renderItem({ onResume, actions: { onOpenInNewTab } })

    const btn = screen.getByTitle('Resume session (Alt+Click or middle-click for new browser tab)')
    btn.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }))

    expect(onOpenInNewTab).toHaveBeenCalled()
    expect(onResume).not.toHaveBeenCalled()
  })

  it('shows an automatic name styled apart from a hand-given one', () => {
    renderItem({ session: createSession({ name: null, auto_name: 'Tuning the parser' }) })

    expect(screen.getByText('Tuning the parser')).toHaveClass('sessions-name', 'auto-named')
  })

  it('shows the hand-given name over an automatic one, unstyled', () => {
    renderItem({ session: createSession({ name: 'Mine', auto_name: 'Tuning the parser' }) })

    expect(screen.getByText('Mine')).not.toHaveClass('auto-named')
    expect(screen.queryByText('Tuning the parser')).not.toBeInTheDocument()
  })

  it('handles session without name', () => {
    renderItem({ session: createSession({ name: null }) })

    expect(screen.getByText('abc12345')).toBeInTheDocument()
    expect(screen.queryByText('Test Session')).not.toBeInTheDocument()
  })

  it('shows pin button for all sessions', () => {
    renderItem({ isPinned: false, actions: { onTogglePin: vi.fn() } })

    expect(screen.getByTestId('icon-pin')).toBeInTheDocument()
  })

  it('shows pin button for current session too', () => {
    renderItem({ isCurrent: true, isPinned: false, actions: { onTogglePin: vi.fn() } })

    expect(screen.getByTestId('icon-pin')).toBeInTheDocument()
  })

  it('applies pinned class when isPinned=true', () => {
    renderItem({ isPinned: true, actions: { onTogglePin: vi.fn() } })

    const pinBtn = screen.getByTestId('session-pin-btn')
    expect(pinBtn).toHaveClass('pinned')
  })

  it('does not apply pinned class when isPinned=false', () => {
    renderItem({ isPinned: false, actions: { onTogglePin: vi.fn() } })

    const pinBtn = screen.getByTestId('session-pin-btn')
    expect(pinBtn).not.toHaveClass('pinned')
  })

  it('calls onTogglePin when pin button clicked', async () => {
    const user = userEvent.setup()
    const onTogglePin = vi.fn()
    renderItem({ isPinned: false, actions: { onTogglePin } })

    await user.click(screen.getByTitle('Pin session'))

    expect(onTogglePin).toHaveBeenCalled()
  })

  it('shows unpin title when pinned', () => {
    renderItem({ isPinned: true, actions: { onTogglePin: vi.fn() } })

    expect(screen.getByTitle('Unpin session')).toBeInTheDocument()
  })

  describe('Kill container button', () => {
    it("shows kill button while the session's container runs", () => {
      renderItem({
        session: createSession({ container_id: 'ctr-123' }),
        status: 'running',
        isPinned: false,
        actions: { onTogglePin: vi.fn(), onKillContainer: vi.fn() },
      })

      expect(screen.getByTestId('session-kill-btn')).toBeInTheDocument()
    })

    it('hides kill button when the session has no container', () => {
      renderItem({
        session: createSession({ container_id: null }),
        isPinned: false,
        actions: { onTogglePin: vi.fn(), onKillContainer: vi.fn() },
      })

      expect(screen.queryByTestId('session-kill-btn')).not.toBeInTheDocument()
    })

    it('calls onKillContainer when kill button clicked', async () => {
      const user = userEvent.setup()
      const onKillContainer = vi.fn()
      renderItem({
        session: createSession({ container_id: 'ctr-123' }),
        status: 'running',
        isPinned: false,
        actions: { onTogglePin: vi.fn(), onKillContainer },
      })

      await user.click(screen.getByTitle('Stop container'))

      expect(onKillContainer).toHaveBeenCalled()
    })

    it('draws the dot from the status it is given, whatever the session record says', () => {
      const { container, rerender } = renderItem({
        session: createSession({ container_id: null }),
        status: 'running',
        actions: { onTogglePin: vi.fn(), onKillContainer: vi.fn() },
      })
      expect(container.querySelector('.container-status-dot')).toHaveClass(
        'container-status-running',
      )

      rerender(
        <SessionItem
          session={createSession({ container_id: null })}
          status="stopping"
          isCurrent={false}
          onResume={vi.fn()}
          onRename={vi.fn()}
          actions={{ onTogglePin: vi.fn(), onKillContainer: vi.fn() }}
        />,
      )
      expect(container.querySelector('.container-status-dot')).toHaveClass(
        'container-status-stopping',
      )
      expect(screen.getByTestId('session-kill-btn')).toBeDisabled()
    })
  })

  describe('row states', () => {
    const renderRow = props =>
      render(
        <SessionItem
          session={createSession({ container_id: 'ctr-1' })}
          status="running"
          isCurrent={false}
          onResume={vi.fn()}
          onRename={vi.fn()}
          actions={{ onTogglePin: vi.fn(), onKillContainer: vi.fn() }}
          {...props}
        />,
      )

    it('marks the dot and shows the reason, unquoted, in place of the last message', () => {
      const { container } = renderRow({ dot: 'needs-you', reason: 'Decide: which path to keep' })

      const dot = container.querySelector('.container-status-dot')
      expect(dot).toHaveClass('container-status-needs-you')
      expect(dot).toHaveAttribute('title', 'Needs you')
      const last = container.querySelector('.sessions-last')
      expect(last).toHaveTextContent(/^Decide: which path to keep$/)
      expect(last.querySelector('span')).toHaveAttribute('title', 'Decide: which path to keep')
      expect(screen.queryByText('"...Goodbye world"')).not.toBeInTheDocument()
    })

    it('keeps the last message when only a hidden fork needs you', () => {
      const { container } = renderRow({ dot: 'needs-you', reason: null })

      expect(container.querySelector('.container-status-dot')).toHaveClass(
        'container-status-needs-you',
      )
      expect(screen.getByText('"...Goodbye world"')).toBeInTheDocument()
    })

    it.each([
      ['working', 'Working'],
      ['waiting', 'Waiting on background work'],
    ])('marks the dot %s with the tooltip %s and keeps the last message', (dot, title) => {
      const { container } = renderRow({ dot })

      const dotEl = container.querySelector('.container-status-dot')
      expect(dotEl).toHaveClass(`container-status-${dot}`)
      expect(dotEl).toHaveAttribute('title', title)
      expect(screen.getByText('"...Goodbye world"')).toBeInTheDocument()
    })

    it('offers no stop for a row whose own container is gone, whatever its dot', () => {
      renderRow({ status: 'none', dot: 'needs-you' })

      expect(screen.queryByTestId('session-kill-btn')).not.toBeInTheDocument()
    })
  })

  describe('Save/Cancel button clicks', () => {
    it('saves rename when Save button is clicked', async () => {
      const { user, onRename } = await startRename()
      const input = screen.getByPlaceholderText('Session name...')
      await user.clear(input)
      await user.type(input, 'Button Save Name')

      await user.click(screen.getByTitle('Save'))

      expect(onRename).toHaveBeenCalledWith('Button Save Name')
      expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument()
    })

    it('cancels rename when Cancel button is clicked', async () => {
      const { user, onRename } = await startRename()
      const input = screen.getByPlaceholderText('Session name...')
      await user.type(input, 'Should Not Save')

      await user.click(screen.getByTitle('Cancel'))

      expect(onRename).not.toHaveBeenCalled()
      expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument()
    })
  })

  describe('mobile branch (isMobile=true)', () => {
    it('hides pin, kill, and resume split-button', () => {
      renderItem({
        isMobile: true,
        session: createSession({ container_id: 'c-1' }),
        status: 'running',
      })

      expect(screen.queryByTestId('session-pin-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('session-kill-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('session-resume-btn')).not.toBeInTheDocument()
    })

    it('outer-card click calls onResume for non-current session', async () => {
      const user = userEvent.setup()
      const onResume = vi.fn()
      renderItem({ isMobile: true, onResume })

      await user.click(screen.getByTestId('session-item'))

      expect(onResume).toHaveBeenCalledOnce()
    })

    it('outer-card click calls onClose for current session, no resume', async () => {
      const user = userEvent.setup()
      const onResume = vi.fn()
      const onClose = vi.fn()
      renderItem({ isMobile: true, isCurrent: true, onResume, onClose })

      await user.click(screen.getByTestId('session-item'))

      expect(onClose).toHaveBeenCalledOnce()
      expect(onResume).not.toHaveBeenCalled()
    })

    it('edit pencil click stops propagation to the outer-card click', async () => {
      const user = userEvent.setup()
      const onResume = vi.fn()
      renderItem({ isMobile: true, onResume })

      await user.click(screen.getByTitle('Rename session'))

      expect(screen.getByPlaceholderText('Session name...')).toBeInTheDocument()
      expect(onResume).not.toHaveBeenCalled()
    })

    it('outer card exposes role=button when mobile and not editing', () => {
      renderItem({ isMobile: true })

      const card = screen.getByTestId('session-item')
      expect(card).toHaveAttribute('role', 'button')
      expect(card).toHaveAttribute('tabindex', '0')
    })
  })
})

const NOW = Date.parse('2026-03-01T12:00:00Z')

const idleSession = {
  session_id: 'abc12345-6789-0def-ghij-klmnopqrstuv',
  session_dir: '/tmp/sessions/abc12345',
  name: 'Idle one',
  started_at: new Date(NOW).toISOString(),
  updated_at: null,
  num_turns: 1,
  total_cost_usd: 0,
  todos: [],
  commands: [],
}

function row() {
  return (
    <SessionItem session={idleSession} isCurrent={false} onResume={vi.fn()} onRename={vi.fn()} />
  )
}

describe('SessionItem relative time', () => {
  beforeEach(() => {
    realRelativeTime = true
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    realRelativeTime = false
    vi.useRealTimers()
  })

  it('reads 3h ago after three idle hours with no redraw from its parent', () => {
    render(row())
    expect(screen.getByText('just now')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(3 * 3600_000))

    expect(screen.getByText('3h ago')).toBeInTheDocument()
  })

  it('a redraw with the same session object after the clock moved shows the new text', () => {
    const { rerender } = render(row())
    act(() => vi.advanceTimersByTime(5 * 60_000))

    rerender(row())

    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })
})
