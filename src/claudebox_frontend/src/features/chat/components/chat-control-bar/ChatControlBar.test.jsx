/** Tests for ChatControlBar. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatControlBar from './ChatControlBar'

// Mock useIsMobile to always return desktop
vi.mock('../../../../hooks/useIsMobile', () => ({
  default: () => false,
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowDownToLine: () => <span data-testid="icon-arrow-down">ArrowDown</span>,
  Check: () => <span data-testid="icon-check">Check</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronUp: () => <span data-testid="icon-chevron-up">ChevronUp</span>,
  GitFork: () => <span data-testid="icon-git-fork">GitFork</span>,
  Loader2: ({ className }) => (
    <span data-testid="icon-loader" className={className}>
      Loader
    </span>
  ),
  Map: () => <span data-testid="icon-map">Map</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  Pencil: () => <span data-testid="icon-pencil">Pencil</span>,
  Pin: () => <span data-testid="icon-pin">Pin</span>,
  RefreshCw: () => <span data-testid="icon-refresh">Refresh</span>,
  StickyNote: () => <span data-testid="icon-sticky-note">StickyNote</span>,
  X: () => <span data-testid="icon-x">X</span>,
}))

// Mock chat API
let mockSendMessage = vi.fn(() => Promise.resolve())
vi.mock('../../../../api/chat', () => ({
  sendMessage: (...args) => mockSendMessage(...args),
}))

// Mock sessions API
let mockUpdateSession = vi.fn(() => Promise.resolve())
let mockUpdateSessionPrompt = vi.fn(() => Promise.resolve())
vi.mock('../../../../api/sessions', () => ({
  updateSession: (...args) => mockUpdateSession(...args),
  updateSessionPrompt: (...args) => mockUpdateSessionPrompt(...args),
}))

// Mock contexts
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
      onJumpPrev: vi.fn(),
      onJumpNext: vi.fn(),
      minimapPinned: false,
      onToggleMinimap: vi.fn(),
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
      expect(separators).toHaveLength(4)
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
      // Edit-mode wrapper must be a panel-control-group flex container so
      // the input + buttons render inline with the shared 4px gap.
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
      // The fork button must mirror the per-turn RewindSplitButton UX —
      // spinner visible while a control-bar fork is in flight.
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
})
