/** Tests for ChatControlBar. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RightSlotView } from '../../utils/rightSlotViews'
import ChatControlBar from './ChatControlBar'

vi.mock('../../../../hooks/useIsMobile', () => ({
  default: () => false,
}))

vi.mock('lucide-react', () => ({
  ArrowDownToLine: () => <span data-testid="icon-arrow-down">ArrowDown</span>,
  Check: () => <span data-testid="icon-check">Check</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronsDownUp: () => <span data-testid="icon-chevrons-down-up">ChevronsDownUp</span>,
  ChevronUp: () => <span data-testid="icon-chevron-up">ChevronUp</span>,
  GitFork: () => <span data-testid="icon-git-fork">GitFork</span>,
  Loader2: ({ className }) => (
    <span data-testid="icon-loader" className={className}>
      Loader
    </span>
  ),
  Map: () => <span data-testid="icon-map">Map</span>,
  MessageSquareQuote: () => <span data-testid="icon-message-square-quote">MessageSquareQuote</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  Pencil: () => <span data-testid="icon-pencil">Pencil</span>,
  Pin: () => <span data-testid="icon-pin">Pin</span>,
  RefreshCw: () => <span data-testid="icon-refresh">Refresh</span>,
  SquareSplitHorizontal: () => <span data-testid="icon-split">SquareSplitHorizontal</span>,
  StickyNote: () => <span data-testid="icon-sticky-note">StickyNote</span>,
  Wrench: () => <span data-testid="icon-wrench">Wrench</span>,
  X: () => <span data-testid="icon-x">X</span>,
}))

let mockSendMessage = vi.fn(() => Promise.resolve())
vi.mock('../../../../api/chat', () => ({
  sendMessage: (...args) => mockSendMessage(...args),
}))

let mockUpdateSession = vi.fn(() => Promise.resolve())
let mockUpdateSessionPrompt = vi.fn(() => Promise.resolve())
vi.mock('../../../../api/sessions', () => ({
  updateSession: (...args) => mockUpdateSession(...args),
  updateSessionPrompt: (...args) => mockUpdateSessionPrompt(...args),
}))

let mockSessionId = 'test-session-id'
let mockSessionName = 'Test Session'
let mockRefreshSession = vi.fn(() => Promise.resolve())
let mockPinnedSessions = []
let mockTogglePin = vi.fn()
let mockRefresh = vi.fn()

let mockSessionPrompt = null
vi.mock('../../../../context/SessionDataContext', () => ({
  useSessionData: () => ({
    sessionId: mockSessionId,
    sessionName: mockSessionName,
    sessionPrompt: mockSessionPrompt,
  }),
  useSessionActions: () => ({
    refreshSession: mockRefreshSession,
  }),
}))

vi.mock('../../../../context/SessionsContext', () => ({
  useSessionsList: () => ({
    pinnedSessions: mockPinnedSessions,
    togglePin: mockTogglePin,
    refresh: mockRefresh,
  }),
}))

vi.mock('../../../../context/AppActionsContext', () => ({
  useAppActions: () => ({}),
}))

describe('ChatControlBar', () => {
  let defaultProps

  beforeEach(() => {
    mockSendMessage = vi.fn(() => Promise.resolve())
    mockUpdateSession = vi.fn(() => Promise.resolve())
    mockUpdateSessionPrompt = vi.fn(() => Promise.resolve())
    mockSessionId = 'test-session-id'
    mockSessionName = 'Test Session'
    mockSessionPrompt = null
    mockRefreshSession = vi.fn(() => Promise.resolve())
    mockPinnedSessions = []
    mockTogglePin = vi.fn()
    mockRefresh = vi.fn()

    defaultProps = {
      onReload: vi.fn(),
      messagesRef: { current: { scrollTop: 0, scrollHeight: 1000 } },
      autoScrollEnabledRef: { current: false },
      isAutoScrollEnabled: false,
      autoCollapseEnabled: true,
      onToggleAutoCollapse: vi.fn(),
      onJumpPrev: vi.fn(),
      onJumpNext: vi.fn(),
      minimapPinned: false,
      onToggleMinimap: vi.fn(),
      rightSlotView: RightSlotView.TERMINAL,
      onSelectRightSlotView: vi.fn(),
    }
  })

  it('renders pin, rename, reload, compact, jump prev/next, autoscroll, and minimap buttons', () => {
    render(<ChatControlBar {...defaultProps} />)

    expect(screen.getByTitle('Pin session')).toBeInTheDocument()
    expect(screen.getByTitle('Rename session')).toBeInTheDocument()
    expect(screen.getByTitle('Reload session (picks up config changes)')).toBeInTheDocument()
    expect(screen.getByTitle('Compact conversation (/compact)')).toBeInTheDocument()
    expect(screen.getByTitle('Previous message (Alt+Up)')).toBeInTheDocument()
    expect(screen.getByTitle('Next message (Alt+Down)')).toBeInTheDocument()
    expect(screen.getByTitle('Last message (Alt+End)')).toBeInTheDocument()
    expect(screen.getByTitle('Show minimap')).toBeInTheDocument()
  })

  it('calls onReload when reload button is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatControlBar {...defaultProps} />)

    await user.click(screen.getByTitle('Reload session (picks up config changes)'))

    expect(defaultProps.onReload).toHaveBeenCalledOnce()
  })

  it('sends /compact when compact button is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatControlBar {...defaultProps} />)

    await user.click(screen.getByTitle('Compact conversation (/compact)'))

    expect(mockSendMessage).toHaveBeenCalledWith('/compact')
  })

  it('scrolls to bottom and enables auto-scroll when autoscroll button is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatControlBar {...defaultProps} />)

    await user.click(screen.getByTitle('Last message (Alt+End)'))

    expect(defaultProps.messagesRef.current.scrollTop).toBe(
      defaultProps.messagesRef.current.scrollHeight,
    )
    expect(defaultProps.autoScrollEnabledRef.current).toBe(true)
  })

  it('disables autoscroll button when auto-scroll is enabled', () => {
    render(<ChatControlBar {...defaultProps} isAutoScrollEnabled={true} />)

    const btn = screen.getByTitle('Autoscroll enabled')
    expect(btn).toBeDisabled()
  })

  it('enables autoscroll button when auto-scroll is disabled', () => {
    render(<ChatControlBar {...defaultProps} isAutoScrollEnabled={false} />)

    const btn = screen.getByTitle('Last message (Alt+End)')
    expect(btn).not.toBeDisabled()
  })

  it('marks button as pressed when auto-scroll is enabled', () => {
    render(<ChatControlBar {...defaultProps} isAutoScrollEnabled={true} />)

    const btn = screen.getByTitle('Autoscroll enabled')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('marks button as not pressed when auto-scroll is disabled', () => {
    render(<ChatControlBar {...defaultProps} isAutoScrollEnabled={false} />)

    const btn = screen.getByTitle('Last message (Alt+End)')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('handles compact failure gracefully', async () => {
    const user = userEvent.setup()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSendMessage = vi.fn(() => Promise.reject(new Error('fail')))

    render(<ChatControlBar {...defaultProps} />)

    await user.click(screen.getByTitle('Compact conversation (/compact)'))

    expect(warnSpy).toHaveBeenCalledWith(
      'ChatControlBar: Failed to send /compact',
      expect.any(Error),
    )

    warnSpy.mockRestore()
  })

  describe('jump navigation buttons', () => {
    it('calls onJumpPrev when up button is clicked', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Previous message (Alt+Up)'))

      expect(defaultProps.onJumpPrev).toHaveBeenCalledOnce()
    })

    it('calls onJumpNext when down button is clicked', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Next message (Alt+Down)'))

      expect(defaultProps.onJumpNext).toHaveBeenCalledOnce()
    })

    it('renders separators between button groups', () => {
      const { container } = render(<ChatControlBar {...defaultProps} />)

      const separators = container.querySelectorAll('.panel-control-separator')
      expect(separators).toHaveLength(5)
    })
  })

  describe('pin button', () => {
    it('shows pressed state when session is pinned', () => {
      mockPinnedSessions = ['test-session-id']
      render(<ChatControlBar {...defaultProps} />)

      const btn = screen.getByTitle('Unpin session')
      expect(btn).toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows unpressed state when session is not pinned', () => {
      mockPinnedSessions = []
      render(<ChatControlBar {...defaultProps} />)

      const btn = screen.getByTitle('Pin session')
      expect(btn).not.toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'false')
    })

    it('calls togglePin when clicked', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Pin session'))

      expect(mockTogglePin).toHaveBeenCalledWith('test-session-id')
    })

    it('disables pin button when no session loaded', () => {
      mockSessionId = null
      render(<ChatControlBar {...defaultProps} />)

      const btn = screen.getByTitle('Pin session')
      expect(btn).toBeDisabled()
    })
  })

  describe('minimap toggle', () => {
    it('shows pressed state when minimap is pinned', () => {
      render(<ChatControlBar {...defaultProps} minimapPinned={true} />)

      const btn = screen.getByTitle('Hide minimap')
      expect(btn).toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows unpressed state when minimap is not pinned', () => {
      render(<ChatControlBar {...defaultProps} minimapPinned={false} />)

      const btn = screen.getByTitle('Show minimap')
      expect(btn).not.toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'false')
    })

    it('calls onToggleMinimap when clicked', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Show minimap'))

      expect(defaultProps.onToggleMinimap).toHaveBeenCalledOnce()
    })
  })

  describe('auto-collapse toggle', () => {
    it('shows pressed state when auto-collapse is enabled', () => {
      render(<ChatControlBar {...defaultProps} autoCollapseEnabled={true} />)

      const btn = screen.getByTestId('autocollapse-toggle')
      expect(btn).toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'true')
      expect(btn).toHaveAttribute('title', 'Disable auto-collapse')
    })

    it('shows unpressed state when auto-collapse is disabled', () => {
      render(<ChatControlBar {...defaultProps} autoCollapseEnabled={false} />)

      const btn = screen.getByTestId('autocollapse-toggle')
      expect(btn).not.toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'false')
      expect(btn).toHaveAttribute('title', 'Enable auto-collapse')
    })

    it('calls onToggleAutoCollapse when clicked', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTestId('autocollapse-toggle'))

      expect(defaultProps.onToggleAutoCollapse).toHaveBeenCalledOnce()
    })
  })

  describe('right-slot view picker (off / terminal / work)', () => {
    it('shows the terminal button pressed when the view is terminal', () => {
      render(<ChatControlBar {...defaultProps} rightSlotView={RightSlotView.TERMINAL} />)

      const terminalBtn = screen.getByTestId('right-slot-view-terminal')
      expect(terminalBtn).toHaveClass('pressed')
      expect(terminalBtn).toHaveAttribute('aria-pressed', 'true')
      expect(terminalBtn).toHaveAttribute('title', "Hide agent's terminal")
      const workBtn = screen.getByTestId('right-slot-view-work')
      expect(workBtn).not.toHaveClass('pressed')
      expect(workBtn).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows the work button pressed when the view is work', () => {
      render(<ChatControlBar {...defaultProps} rightSlotView={RightSlotView.WORK} />)

      const workBtn = screen.getByTestId('right-slot-view-work')
      expect(workBtn).toHaveClass('pressed')
      expect(workBtn).toHaveAttribute('aria-pressed', 'true')
      expect(workBtn).toHaveAttribute('title', 'Hide the work panel')
      const terminalBtn = screen.getByTestId('right-slot-view-terminal')
      expect(terminalBtn).not.toHaveClass('pressed')
      expect(terminalBtn).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows neither button pressed when the view is off', () => {
      render(<ChatControlBar {...defaultProps} rightSlotView={RightSlotView.OFF} />)

      expect(screen.getByTestId('right-slot-view-terminal')).not.toHaveClass('pressed')
      expect(screen.getByTestId('right-slot-view-work')).not.toHaveClass('pressed')
      expect(screen.getByTestId('right-slot-view-terminal')).toHaveAttribute(
        'title',
        "Show agent's terminal",
      )
      expect(screen.getByTestId('right-slot-view-work')).toHaveAttribute(
        'title',
        "Show the agent's work",
      )
    })

    it('selecting terminal from off calls onSelectRightSlotView with TERMINAL', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} rightSlotView={RightSlotView.OFF} />)

      await user.click(screen.getByTestId('right-slot-view-terminal'))

      expect(defaultProps.onSelectRightSlotView).toHaveBeenCalledWith(RightSlotView.TERMINAL)
    })

    it('selecting work from off calls onSelectRightSlotView with WORK', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} rightSlotView={RightSlotView.OFF} />)

      await user.click(screen.getByTestId('right-slot-view-work'))

      expect(defaultProps.onSelectRightSlotView).toHaveBeenCalledWith(RightSlotView.WORK)
    })

    it('clicking the pressed terminal button turns the view off', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} rightSlotView={RightSlotView.TERMINAL} />)

      await user.click(screen.getByTestId('right-slot-view-terminal'))

      expect(defaultProps.onSelectRightSlotView).toHaveBeenCalledWith(RightSlotView.OFF)
    })

    it('clicking work while terminal is pressed switches to work', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} rightSlotView={RightSlotView.TERMINAL} />)

      await user.click(screen.getByTestId('right-slot-view-work'))

      expect(defaultProps.onSelectRightSlotView).toHaveBeenCalledWith(RightSlotView.WORK)
    })

    it('sits immediately after the auto-collapse button with no separator between them', () => {
      render(<ChatControlBar {...defaultProps} />)

      const autoCollapse = screen.getByTestId('autocollapse-toggle')
      const picker = screen.getByTestId('right-slot-view-picker')
      expect(autoCollapse.nextElementSibling).toBe(picker)
    })
  })

  describe('rename button', () => {
    it('renders rename button in left group with canonical chrome', () => {
      render(<ChatControlBar {...defaultProps} />)
      const btn = screen.getByTitle('Rename session')
      expect(btn).toBeInTheDocument()
      expect(btn).toHaveClass('panel-control-btn')
    })

    it('disables rename button when no session loaded', () => {
      mockSessionId = null
      render(<ChatControlBar {...defaultProps} />)
      const btn = screen.getByTitle('Rename session')
      expect(btn).toBeDisabled()
      expect(btn).toHaveClass('panel-control-btn')
    })

    it('enters edit mode when rename button clicked', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))

      expect(screen.getByPlaceholderText('Session name...')).toBeInTheDocument()
      const saveBtn = screen.getByTitle('Save')
      const cancelBtn = screen.getByTitle('Cancel')
      expect(saveBtn).toBeInTheDocument()
      expect(cancelBtn).toBeInTheDocument()
      // Save and cancel buttons must inherit canonical chrome.
      expect(saveBtn).toHaveClass('panel-control-btn')
      expect(cancelBtn).toHaveClass('panel-control-btn')
      // Wrapper must be a panel-control-group so input + buttons render inline with the shared 4px gap.
      const wrapper = saveBtn.closest('.chat-control-edit-mode')
      expect(wrapper).toHaveClass('panel-control-group')
    })

    it('pre-fills input with current session name', async () => {
      mockSessionName = 'My Session'
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))

      expect(screen.getByPlaceholderText('Session name...')).toHaveValue('My Session')
    })

    it('saves on Enter key', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))
      const input = screen.getByPlaceholderText('Session name...')
      await user.clear(input)
      await user.type(input, 'New Name{Enter}')

      expect(mockUpdateSession).toHaveBeenCalledWith('test-session-id', { name: 'New Name' })
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('cancels on Escape key', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))
      await user.keyboard('{Escape}')

      expect(screen.getByTitle('Rename session')).toBeInTheDocument()
      expect(mockUpdateSession).not.toHaveBeenCalled()
    })

    it('cancels via cancel button', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))
      await user.click(screen.getByTitle('Cancel'))

      expect(screen.getByTitle('Rename session')).toBeInTheDocument()
      expect(mockUpdateSession).not.toHaveBeenCalled()
    })

    it('unsets name when empty string submitted', async () => {
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))
      const input = screen.getByPlaceholderText('Session name...')
      await user.clear(input)
      await user.click(screen.getByTitle('Save'))

      expect(mockUpdateSession).toHaveBeenCalledWith('test-session-id', { name: null })
      expect(screen.getByTitle('Rename session')).toBeInTheDocument()
    })

    it('does not call API if name unchanged', async () => {
      mockSessionName = 'Same Name'
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))
      await user.click(screen.getByTitle('Save'))

      expect(mockUpdateSession).not.toHaveBeenCalled()
    })

    it('does not call API when name already unset and empty submitted', async () => {
      mockSessionName = null
      const user = userEvent.setup()
      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))
      await user.click(screen.getByTitle('Save'))

      expect(mockUpdateSession).not.toHaveBeenCalled()
    })

    it('handles API error gracefully', async () => {
      const user = userEvent.setup()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateSession = vi.fn(() => Promise.reject(new Error('fail')))

      render(<ChatControlBar {...defaultProps} />)

      await user.click(screen.getByTitle('Rename session'))
      const input = screen.getByPlaceholderText('Session name...')
      await user.clear(input)
      await user.type(input, 'New Name{Enter}')

      expect(warnSpy).toHaveBeenCalledWith(
        'ChatControlBar: Failed to rename session',
        expect.any(Error),
      )
      // Should exit edit mode even on error
      expect(screen.getByTitle('Rename session')).toBeInTheDocument()

      warnSpy.mockRestore()
    })
  })

  describe('session-prompt button', () => {
    it('uses canonical panel-control-btn chrome', () => {
      render(<ChatControlBar {...defaultProps} />)
      const btn = screen.getByTitle('Set session prompt')
      expect(btn).toHaveClass('panel-control-btn')
      expect(btn).toHaveClass('session-prompt-btn')
    })

    it('keeps canonical chrome and adds has-content modifier when prompt is set', () => {
      mockSessionPrompt = 'Inject me after compaction.'
      render(<ChatControlBar {...defaultProps} />)
      const btn = screen.getByTitle('Edit session prompt')
      expect(btn).toHaveClass('panel-control-btn')
      expect(btn).toHaveClass('session-prompt-btn')
      expect(btn).toHaveClass('has-content')
    })
  })

  describe('fork button spinner', () => {
    it('shows GitFork icon when not forking', () => {
      render(<ChatControlBar {...defaultProps} forking={false} />)

      const forkBtn = screen.getByTitle(
        'Fork session (Alt+Click or middle-click for new browser tab)',
      )
      expect(forkBtn).not.toBeDisabled()
      expect(forkBtn.querySelector('[data-testid="icon-git-fork"]')).toBeInTheDocument()
      expect(forkBtn.querySelector('[data-testid="icon-loader"]')).toBeNull()
    })

    it('swaps to spinning Loader2 when forking is true', () => {
      // Mirrors the per-turn RewindSplitButton UX: spinner visible while a control-bar fork is in flight.
      render(<ChatControlBar {...defaultProps} forking={true} />)

      const forkBtn = screen.getByTitle(
        'Fork session (Alt+Click or middle-click for new browser tab)',
      )
      const loader = forkBtn.querySelector('[data-testid="icon-loader"]')
      expect(loader).toBeInTheDocument()
      expect(loader).toHaveClass('spin')
      expect(forkBtn.querySelector('[data-testid="icon-git-fork"]')).toBeNull()
      expect(forkBtn).toBeDisabled()
    })
  })

  describe('terminal group (split on)', () => {
    const splitProps = {
      showTerminalSplit: true,
      terminalSplitRatio: 0.5,
      terminalAutoScrollEnabled: true,
      onTerminalJumpToBottom: vi.fn(),
      onTerminalJumpPrev: vi.fn(),
      onTerminalJumpNext: vi.fn(),
      terminalMinimapPinned: true,
      onToggleTerminalMinimap: vi.fn(),
    }

    it('renders exactly one panel-control-bar, divided into two halves', () => {
      const { container } = render(<ChatControlBar {...defaultProps} {...splitProps} />)

      expect(container.querySelectorAll('.panel-control-bar')).toHaveLength(1)
      expect(container.querySelector('.panel-control-bar-left')).toBeInTheDocument()
      expect(container.querySelector('.panel-control-bar-right')).toBeInTheDocument()
    })

    it('renders an undivided bar when showTerminalSplit is false', () => {
      const { container } = render(
        <ChatControlBar {...defaultProps} {...splitProps} showTerminalSplit={false} />,
      )

      expect(container.querySelector('.panel-control-bar-left')).toBeNull()
      expect(container.querySelector('.panel-control-bar-right')).toBeNull()
    })

    it('gives the terminal control a distinct testid from the transcript autoscroll indicator', () => {
      render(<ChatControlBar {...defaultProps} {...splitProps} />)

      expect(screen.getByTestId('terminal-autoscroll-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('autoscroll-indicator')).toBeInTheDocument()
    })

    it('shows the terminal control pressed and disabled when following', () => {
      render(<ChatControlBar {...defaultProps} {...splitProps} terminalAutoScrollEnabled={true} />)

      const btn = screen.getByTestId('terminal-autoscroll-indicator')
      expect(btn).toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'true')
      expect(btn).toBeDisabled()
    })

    it('shows the terminal control unpressed and enabled when not following', () => {
      render(<ChatControlBar {...defaultProps} {...splitProps} terminalAutoScrollEnabled={false} />)

      const btn = screen.getByTestId('terminal-autoscroll-indicator')
      expect(btn).not.toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'false')
      expect(btn).not.toBeDisabled()
    })

    it('calls onTerminalJumpToBottom when the terminal control is clicked', async () => {
      const user = userEvent.setup()
      const onTerminalJumpToBottom = vi.fn()
      render(
        <ChatControlBar
          {...defaultProps}
          {...splitProps}
          terminalAutoScrollEnabled={false}
          onTerminalJumpToBottom={onTerminalJumpToBottom}
        />,
      )

      await user.click(screen.getByTestId('terminal-autoscroll-indicator'))

      expect(onTerminalJumpToBottom).toHaveBeenCalledOnce()
    })

    it('renders up and down controls left of the autoscroll control, in that order', () => {
      render(<ChatControlBar {...defaultProps} {...splitProps} />)

      const prev = screen.getByTestId('terminal-jump-prev')
      const next = screen.getByTestId('terminal-jump-next')
      const indicator = screen.getByTestId('terminal-autoscroll-indicator')
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(
        next.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('calls onTerminalJumpPrev when the up control is clicked', async () => {
      const user = userEvent.setup()
      const onTerminalJumpPrev = vi.fn()
      render(
        <ChatControlBar
          {...defaultProps}
          {...splitProps}
          onTerminalJumpPrev={onTerminalJumpPrev}
        />,
      )

      await user.click(screen.getByTestId('terminal-jump-prev'))

      expect(onTerminalJumpPrev).toHaveBeenCalledOnce()
    })

    it('calls onTerminalJumpNext when the down control is clicked', async () => {
      const user = userEvent.setup()
      const onTerminalJumpNext = vi.fn()
      render(
        <ChatControlBar
          {...defaultProps}
          {...splitProps}
          onTerminalJumpNext={onTerminalJumpNext}
        />,
      )

      await user.click(screen.getByTestId('terminal-jump-next'))

      expect(onTerminalJumpNext).toHaveBeenCalledOnce()
    })

    it('has no jump-to-top or jump-to-end control in the terminal group', () => {
      const { container } = render(<ChatControlBar {...defaultProps} {...splitProps} />)

      // prev, next, autoscroll indicator, map toggle - no jump-to-top/jump-to-end pair.
      const right = container.querySelector('.panel-control-bar-right')
      expect(right.querySelectorAll('button')).toHaveLength(4)
    })

    it('renders the map toggle rightmost in the terminal group', () => {
      render(<ChatControlBar {...defaultProps} {...splitProps} />)

      const indicator = screen.getByTestId('terminal-autoscroll-indicator')
      const mapToggle = screen.getByTestId('terminal-minimap-toggle')
      expect(
        indicator.compareDocumentPosition(mapToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('shows the terminal map toggle pressed when the overview is pinned', () => {
      render(<ChatControlBar {...defaultProps} {...splitProps} terminalMinimapPinned={true} />)

      const btn = screen.getByTestId('terminal-minimap-toggle')
      expect(btn).toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows the terminal map toggle unpressed when the overview is unpinned', () => {
      render(<ChatControlBar {...defaultProps} {...splitProps} terminalMinimapPinned={false} />)

      const btn = screen.getByTestId('terminal-minimap-toggle')
      expect(btn).not.toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'false')
    })

    it('calls onToggleTerminalMinimap when the terminal map toggle is clicked', async () => {
      const user = userEvent.setup()
      const onToggleTerminalMinimap = vi.fn()
      render(
        <ChatControlBar
          {...defaultProps}
          {...splitProps}
          onToggleTerminalMinimap={onToggleTerminalMinimap}
        />,
      )

      await user.click(screen.getByTestId('terminal-minimap-toggle'))

      expect(onToggleTerminalMinimap).toHaveBeenCalledOnce()
    })
  })

  describe('work group (work view on)', () => {
    const workProps = {
      showWorkView: true,
      terminalSplitRatio: 0.5,
      workAutoScrollEnabled: true,
      onWorkJumpToBottom: vi.fn(),
      onWorkJumpPrev: vi.fn(),
      onWorkJumpNext: vi.fn(),
      workMinimapPinned: true,
      onToggleWorkMinimap: vi.fn(),
    }

    it('renders exactly one panel-control-bar, divided into two halves', () => {
      const { container } = render(<ChatControlBar {...defaultProps} {...workProps} />)

      expect(container.querySelectorAll('.panel-control-bar')).toHaveLength(1)
      expect(container.querySelector('.panel-control-bar-left')).toBeInTheDocument()
      expect(container.querySelector('.panel-control-bar-right')).toBeInTheDocument()
    })

    it('renders an undivided bar when showWorkView is false and showTerminalSplit is unset', () => {
      const { container } = render(
        <ChatControlBar {...defaultProps} {...workProps} showWorkView={false} />,
      )

      expect(container.querySelector('.panel-control-bar-left')).toBeNull()
      expect(container.querySelector('.panel-control-bar-right')).toBeNull()
    })

    it('gives the work controls testids distinct from the terminal ones', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} />)

      expect(screen.getByTestId('work-jump-prev')).toBeInTheDocument()
      expect(screen.getByTestId('work-jump-next')).toBeInTheDocument()
      expect(screen.getByTestId('work-autoscroll-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('work-minimap-toggle')).toBeInTheDocument()
      expect(screen.queryByTestId('terminal-autoscroll-indicator')).not.toBeInTheDocument()
    })

    it('shows the work autoscroll control pressed and disabled when following', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} workAutoScrollEnabled={true} />)

      const btn = screen.getByTestId('work-autoscroll-indicator')
      expect(btn).toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'true')
      expect(btn).toBeDisabled()
    })

    it('shows the work autoscroll control unpressed and enabled when not following', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} workAutoScrollEnabled={false} />)

      const btn = screen.getByTestId('work-autoscroll-indicator')
      expect(btn).not.toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'false')
      expect(btn).not.toBeDisabled()
    })

    it('calls onWorkJumpToBottom when the autoscroll control is clicked', async () => {
      const user = userEvent.setup()
      const onWorkJumpToBottom = vi.fn()
      render(
        <ChatControlBar
          {...defaultProps}
          {...workProps}
          workAutoScrollEnabled={false}
          onWorkJumpToBottom={onWorkJumpToBottom}
        />,
      )

      await user.click(screen.getByTestId('work-autoscroll-indicator'))

      expect(onWorkJumpToBottom).toHaveBeenCalledOnce()
    })

    it('renders up and down controls left of the autoscroll control, in that order', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} />)

      const prev = screen.getByTestId('work-jump-prev')
      const next = screen.getByTestId('work-jump-next')
      const indicator = screen.getByTestId('work-autoscroll-indicator')
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(
        next.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('calls onWorkJumpPrev when the up control is clicked', async () => {
      const user = userEvent.setup()
      const onWorkJumpPrev = vi.fn()
      render(<ChatControlBar {...defaultProps} {...workProps} onWorkJumpPrev={onWorkJumpPrev} />)

      await user.click(screen.getByTestId('work-jump-prev'))

      expect(onWorkJumpPrev).toHaveBeenCalledOnce()
    })

    it('calls onWorkJumpNext when the down control is clicked', async () => {
      const user = userEvent.setup()
      const onWorkJumpNext = vi.fn()
      render(<ChatControlBar {...defaultProps} {...workProps} onWorkJumpNext={onWorkJumpNext} />)

      await user.click(screen.getByTestId('work-jump-next'))

      expect(onWorkJumpNext).toHaveBeenCalledOnce()
    })

    it('has no jump-to-top or jump-to-end control in the work group', () => {
      const { container } = render(<ChatControlBar {...defaultProps} {...workProps} />)

      // prev, next, autoscroll indicator, map toggle - no jump-to-top/jump-to-end pair.
      const right = container.querySelector('.panel-control-bar-right')
      expect(right.querySelectorAll('button')).toHaveLength(4)
    })

    it('renders the map toggle rightmost in the work group', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} />)

      const indicator = screen.getByTestId('work-autoscroll-indicator')
      const mapToggle = screen.getByTestId('work-minimap-toggle')
      expect(
        indicator.compareDocumentPosition(mapToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('shows the work map toggle pressed when the overview is pinned', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} workMinimapPinned={true} />)

      const btn = screen.getByTestId('work-minimap-toggle')
      expect(btn).toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows the work map toggle unpressed when the overview is unpinned', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} workMinimapPinned={false} />)

      const btn = screen.getByTestId('work-minimap-toggle')
      expect(btn).not.toHaveClass('pressed')
      expect(btn).toHaveAttribute('aria-pressed', 'false')
    })

    it('calls onToggleWorkMinimap when the work map toggle is clicked', async () => {
      const user = userEvent.setup()
      const onToggleWorkMinimap = vi.fn()
      render(
        <ChatControlBar
          {...defaultProps}
          {...workProps}
          onToggleWorkMinimap={onToggleWorkMinimap}
        />,
      )

      await user.click(screen.getByTestId('work-minimap-toggle'))

      expect(onToggleWorkMinimap).toHaveBeenCalledOnce()
    })

    it('renders no terminal-only controls under the work view', () => {
      render(<ChatControlBar {...defaultProps} {...workProps} />)

      expect(screen.queryByTestId('terminal-jump-prev')).not.toBeInTheDocument()
      expect(screen.queryByTestId('terminal-jump-next')).not.toBeInTheDocument()
      expect(screen.queryByTestId('terminal-minimap-toggle')).not.toBeInTheDocument()
    })
  })
})
