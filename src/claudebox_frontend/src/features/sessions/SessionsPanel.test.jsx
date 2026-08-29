/** Tests for SessionsPanel component. */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SessionsPanel from './SessionsPanel'

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

// Mock API (network boundary)
const mockNewSession = vi.fn()
const mockUpdateSession = vi.fn()
const mockInterrupt = vi.fn()

vi.mock('../../api/chat', () => ({
  interrupt: () => mockInterrupt(),
}))

vi.mock('../../api/sessions', () => ({
  newSession: () => mockNewSession(),
  updateSession: (id, data) => mockUpdateSession(id, data),
}))

// Mock contexts (network boundary)
const mockSessionDataCtx = {
  sessionId: 'current-session',
  workspace: '/home/user/project',
  model: 'claude-sonnet-5',
  permissionMode: 'bypassPermissions',
}

const mockSessionActionsCtx = {
  refreshSession: vi.fn(),
  clearSessionData: vi.fn(),
  seedSessionData: vi.fn(),
}

const mockAppActions = {
  focusChatTab: vi.fn(),
  addSessionTab: vi.fn(),
  updateSessionTabName: vi.fn(),
}

const mockInteraction = {
  setError: vi.fn(),
}

const mockNavigateToSession = vi.fn()

vi.mock('../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
  useSessionActions: () => mockSessionActionsCtx,
}))

vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => mockAppActions,
}))

vi.mock('../../context/InteractionContext', () => ({
  useInteraction: () => mockInteraction,
}))

vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    navigateToSession: mockNavigateToSession,
  }),
}))

vi.mock('../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    containerMap: {},
    stoppingSessions: new Set(),
    addStoppingSession: vi.fn(),
    setSessionContainer: vi.fn(),
    removeSessionContainer: vi.fn(),
    deriveSessionStatus: (_sessionId, _sessions, fallbackContainerId = null) =>
      fallbackContainerId ? 'running' : 'none',
  }),
}))

vi.mock('../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => ({
    clearProgress: vi.fn(),
  }),
}))

vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    workspaceId: 'test-workspace',
  }),
}))

const mockSessionsList = {
  sessions: [],
  pinnedSessions: [],
  loading: false,
  error: null,
  panelFilter: 'conversations',
  panelFilterPick: 'conversations',
  refresh: vi.fn(),
  togglePin: vi.fn(),
  setPanelFilter: vi.fn(),
  setFallbackToAll: vi.fn(),
}

vi.mock('../../context/SessionsContext', () => ({
  useSessionsList: () => mockSessionsList,
}))

const mockEventsCtx = {
  isResponding: false,
  isResuming: false,
  isReplaying: false,
  isCreating: false,
  notifyContainerChanged: vi.fn(),
  startCreating: vi.fn(),
  clearCreating: vi.fn(),
}

vi.mock('../../context/StillRunningToastContext', () => ({
  useStillRunningToast: () => ({
    toast: null,
    showStillRunningToast: vi.fn(),
    dismissStillRunningToast: vi.fn(),
  }),
}))

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => mockEventsCtx,
}))

vi.mock('../../context/StreamingStatusContext', () => ({
  useStreamingStatus: () => ({
    isResuming: mockEventsCtx.isResuming,
    isReplaying: mockEventsCtx.isReplaying,
    isResponding: mockEventsCtx.isResponding,
  }),
}))

vi.mock('../../utils/navigation', () => ({
  openSessionInNewTab: vi.fn(),
}))

// Real SessionItem, real lucide-react - no mocks needed

const makeSession = (id, extra = {}) => ({
  session_id: id,
  session_dir: `/tmp/sessions/${id}`,
  workspace: '/home/user/project',
  model: 'claude-sonnet-5',
  started_at: new Date(Date.now() - 3600000).toISOString(),
  updated_at: new Date(Date.now() - 1800000).toISOString(),
  name: null,
  num_turns: 1,
  total_cost_usd: 0,
  total_duration_ms: 0,
  last_context_tokens: 0,
  first_message: null,
  last_message: null,
  todos: [],
  commands: [],
  parent_session_id: null,
  ...extra,
})

function resetMocks() {
  mockNewSession.mockReset()
  mockUpdateSession.mockReset()
  mockInterrupt.mockReset()
  mockNavigateToSession.mockReset()
  mockEventsCtx.isResponding = false
  mockEventsCtx.isResuming = false
  mockEventsCtx.isReplaying = false
  mockEventsCtx.isCreating = false
  mockEventsCtx.notifyContainerChanged.mockReset()
  mockEventsCtx.startCreating.mockReset()
  mockEventsCtx.clearCreating.mockReset()
  mockInteraction.setError.mockReset()
  mockAppActions.focusChatTab.mockReset()
  mockAppActions.addSessionTab.mockReset()
  mockAppActions.updateSessionTabName.mockReset()
  mockSessionActionsCtx.refreshSession.mockReset()
  mockSessionDataCtx.sessionId = 'current-session'
  mockSessionsList.sessions = []
  mockSessionsList.pinnedSessions = []
  mockSessionsList.loading = false
  mockSessionsList.error = null
  mockSessionsList.panelFilter = 'conversations'
  mockSessionsList.panelFilterPick = 'conversations'
  mockSessionsList.refresh.mockReset()
  mockSessionsList.togglePin.mockReset()
  mockSessionsList.setPanelFilter.mockReset()
  mockSessionsList.setFallbackToAll.mockReset()
}

describe('SessionsPanel', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('shows loading state initially', () => {
    mockSessionsList.loading = true

    render(<SessionsPanel />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders session list', () => {
    mockSessionsList.sessions = [makeSession('session-1'), makeSession('session-2')]

    render(<SessionsPanel />)

    expect(screen.getAllByTestId('session-item')).toHaveLength(2)
  })

  it('shows error state with retry button', () => {
    mockSessionsList.error = 'Network error'

    render(<SessionsPanel />)

    expect(screen.getByText('Failed to load sessions')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('calls handleResume when session resumed', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('session-to-resume')]

    render(<SessionsPanel />)

    await user.click(
      screen.getByTitle('Resume session (Alt+Click or middle-click for new browser tab)'),
    )

    expect(mockNavigateToSession).toHaveBeenCalledWith('test-workspace', 'session-to-resume')
    expect(mockAppActions.focusChatTab).toHaveBeenCalled()
  })

  it('calls handleNewSession when new button clicked', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('s1')]
    mockNewSession.mockResolvedValue({ session_id: 'new-1' })

    render(<SessionsPanel />)

    await user.click(screen.getByTestId('session-new-session-btn'))

    expect(mockNewSession).toHaveBeenCalled()
  })

  it('calls refresh on mount', () => {
    mockSessionsList.sessions = [makeSession('s1')]

    render(<SessionsPanel />)

    expect(mockSessionsList.refresh).toHaveBeenCalled()
  })

  it('refresh button calls context refresh', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('s1')]

    render(<SessionsPanel />)

    mockSessionsList.refresh.mockClear()
    await user.click(screen.getByTitle('Refresh'))

    expect(mockSessionsList.refresh).toHaveBeenCalled()
  })

  it('sorts pinned sessions to top', () => {
    mockSessionsList.sessions = [
      makeSession('unpinned-1'),
      makeSession('pinned-1'),
      makeSession('unpinned-2'),
    ]
    mockSessionsList.pinnedSessions = ['pinned-1']

    render(<SessionsPanel />)

    const items = screen.getAllByTestId('session-item')
    expect(items).toHaveLength(3)
    // Pinned session sorted first - shows first 8 chars of session_id
    expect(items[0]).toHaveTextContent('pinned-1')
  })

  it('toggles pin state via context', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('session-1')]

    render(<SessionsPanel />)

    await user.click(screen.getByTestId('session-pin-btn'))

    expect(mockSessionsList.togglePin).toHaveBeenCalledWith('session-1')
  })

  it('disables new session button and shows spinner when creating', () => {
    mockSessionsList.sessions = [makeSession('s1')]
    mockEventsCtx.isCreating = true

    render(<SessionsPanel />)

    const btn = screen.getByTestId('session-new-session-btn')
    expect(btn).toBeDisabled()
    // Loader2 gets className="spin" - verify spinner is present
    expect(btn.querySelector('.spin')).toBeInTheDocument()
  })

  it('shows pinned title for pinned sessions', () => {
    mockSessionsList.sessions = [makeSession('session-1')]
    mockSessionsList.pinnedSessions = ['session-1']

    render(<SessionsPanel />)

    // Real SessionItem shows "Unpin session" title when pinned
    expect(screen.getByTitle('Unpin session')).toBeInTheDocument()
  })
})

describe('SessionsPanel error paths', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('calls setError when new session fails', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('s1')]
    mockNewSession.mockRejectedValue(new Error('new session error'))

    render(<SessionsPanel />)

    await user.click(screen.getByTestId('session-new-session-btn'))

    expect(mockNewSession).toHaveBeenCalled()
    expect(mockInteraction.setError).toHaveBeenCalledWith('New session failed')
  })

  it('shows "No sessions yet" when sessions list is empty', () => {
    mockSessionsList.sessions = []
    mockSessionsList.loading = false
    mockSessionsList.error = null

    render(<SessionsPanel />)

    expect(screen.getByText('No sessions yet')).toBeInTheDocument()
  })
})

describe('SessionsPanel handleRename', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('calls renameSession API and refreshes list on success', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('rename-target')]
    mockUpdateSession.mockResolvedValue({})

    render(<SessionsPanel />)

    // Real SessionItem: click pencil -> type name -> click save
    await user.click(screen.getByTitle('Rename session'))
    const input = screen.getByPlaceholderText('Session name...')
    await user.type(input, 'new-name')
    await user.click(screen.getByTitle('Save'))

    expect(mockUpdateSession).toHaveBeenCalledWith('rename-target', { name: 'new-name' })
    expect(mockSessionsList.refresh).toHaveBeenCalled()
  })

  it('calls refreshSession when renaming the current session', async () => {
    const user = userEvent.setup()
    mockSessionDataCtx.sessionId = 'current-session'
    mockSessionsList.sessions = [makeSession('current-session')]
    mockUpdateSession.mockResolvedValue({})
    mockSessionActionsCtx.refreshSession.mockResolvedValue({})

    render(<SessionsPanel />)

    await user.click(screen.getByTitle('Rename session'))
    const input = screen.getByPlaceholderText('Session name...')
    await user.type(input, 'new-name')
    await user.click(screen.getByTitle('Save'))

    expect(mockUpdateSession).toHaveBeenCalledWith('current-session', { name: 'new-name' })
    expect(mockSessionActionsCtx.refreshSession).toHaveBeenCalled()
  })

  it('calls setError when rename fails', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('rename-fail')]
    mockUpdateSession.mockRejectedValue(new Error('rename error'))

    render(<SessionsPanel />)

    await user.click(screen.getByTitle('Rename session'))
    const input = screen.getByPlaceholderText('Session name...')
    await user.type(input, 'new-name')
    await user.click(screen.getByTitle('Save'))

    expect(mockUpdateSession).toHaveBeenCalledWith('rename-fail', { name: 'new-name' })
    expect(mockInteraction.setError).toHaveBeenCalledWith('Rename failed')
  })
})

describe('SessionsPanel empty session filtering', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('hides sessions with 0 turns', () => {
    mockSessionsList.sessions = [
      makeSession('has-turns', { num_turns: 3 }),
      makeSession('no-turns', { num_turns: 0 }),
    ]

    render(<SessionsPanel />)

    const items = screen.getAllByTestId('session-item')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('has-turn')
  })

  it('shows active session even with 0 turns', () => {
    mockSessionDataCtx.sessionId = 'active-empty'
    mockSessionsList.sessions = [
      makeSession('has-turns', { num_turns: 3 }),
      makeSession('active-empty', { num_turns: 0 }),
    ]

    render(<SessionsPanel />)

    const items = screen.getAllByTestId('session-item')
    expect(items).toHaveLength(2)

    mockSessionDataCtx.sessionId = 'current-session'
  })
})

describe('SessionsPanel fork sort key', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('sorts parent above sibling when child has newer timestamp', () => {
    mockSessionsList.sessions = [
      makeSession('parent-old', {
        num_turns: 1,
        started_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T01:00:00Z',
      }),
      makeSession('child-new', {
        num_turns: 1,
        parent_session_id: 'parent-old',
        started_at: '2026-01-03T00:00:00Z',
        updated_at: '2026-01-03T12:00:00Z',
      }),
      makeSession('sibling', {
        num_turns: 1,
        started_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T06:00:00Z',
      }),
    ]

    render(<SessionsPanel />)

    const items = screen.getAllByTestId('session-item')
    // parent-old first: descendant child-new has newest timestamp (Jan 3)
    expect(items[0]).toHaveTextContent('parent-o')
    expect(items[1]).toHaveTextContent('sibling')
  })

  it('propagates timestamps recursively through grandchildren', () => {
    mockSessionsList.sessions = [
      makeSession('grandparent', {
        num_turns: 1,
        started_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      makeSession('parent', {
        num_turns: 1,
        parent_session_id: 'grandparent',
        started_at: '2026-01-01T01:00:00Z',
        updated_at: '2026-01-01T01:00:00Z',
      }),
      makeSession('grandchild', {
        num_turns: 1,
        parent_session_id: 'parent',
        started_at: '2026-01-05T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      }),
      makeSession('other-root', {
        num_turns: 1,
        started_at: '2026-01-03T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
      }),
    ]

    render(<SessionsPanel />)

    const items = screen.getAllByTestId('session-item')
    // grandparent first: grandchild timestamp Jan 5 > other-root Jan 3
    expect(items[0]).toHaveTextContent('grandpar')
    expect(items[1]).toHaveTextContent('other-ro')
  })
})

describe('SessionsPanel auto-expand ancestors', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('expands ancestor chain when active session is a fork', () => {
    mockSessionDataCtx.sessionId = 'child-session'
    mockSessionsList.sessions = [
      makeSession('parent-session', { num_turns: 2 }),
      makeSession('child-session', { num_turns: 1, parent_session_id: 'parent-session' }),
    ]

    render(<SessionsPanel />)

    // Child visible (ancestor expanded) - both items rendered
    const items = screen.getAllByTestId('session-item')
    expect(items).toHaveLength(2)
    // Collapse button visible (expanded state)
    expect(screen.getByTitle('Collapse')).toBeInTheDocument()

    mockSessionDataCtx.sessionId = 'current-session'
  })

  it('collapses all when active session is pinned', () => {
    mockSessionDataCtx.sessionId = 'child-session'
    mockSessionsList.sessions = [
      makeSession('parent-session', { num_turns: 2 }),
      makeSession('child-session', { num_turns: 1, parent_session_id: 'parent-session' }),
    ]
    mockSessionsList.pinnedSessions = ['child-session']

    render(<SessionsPanel />)

    // Pinned child at root + parent at root, parent collapsed
    expect(screen.getByTitle('Expand')).toBeInTheDocument()

    mockSessionDataCtx.sessionId = 'current-session'
  })

  it('shows no expand/collapse when active session is root', () => {
    mockSessionDataCtx.sessionId = 'root-session'
    mockSessionsList.sessions = [
      makeSession('root-session', { num_turns: 2 }),
      makeSession('other-session', { num_turns: 1 }),
    ]

    render(<SessionsPanel />)

    expect(screen.queryByTitle('Expand')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Collapse')).not.toBeInTheDocument()

    mockSessionDataCtx.sessionId = 'current-session'
  })
})

describe('SessionsPanel actions while responding', () => {
  beforeEach(() => {
    resetMocks()
    mockEventsCtx.isResponding = true
  })

  it('resumes directly without confirmation modal', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('session-to-resume')]

    render(<SessionsPanel />)

    await user.click(
      screen.getByTitle('Resume session (Alt+Click or middle-click for new browser tab)'),
    )

    expect(screen.queryByText('Claude is working')).not.toBeInTheDocument()
    expect(mockNavigateToSession).toHaveBeenCalledWith('test-workspace', 'session-to-resume')
  })

  it('creates new session directly without confirmation modal', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('s1')]
    mockNewSession.mockResolvedValue({ session_id: 'new-1' })

    render(<SessionsPanel />)

    await user.click(screen.getByTestId('session-new-session-btn'))

    expect(screen.queryByText('Claude is working')).not.toBeInTheDocument()
    expect(mockNewSession).toHaveBeenCalled()
  })
})

describe('SessionsPanel filters', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('renders all six filters as icon buttons, each named by tooltip/accessible name, none by visible text', () => {
    mockSessionsList.sessions = [
      makeSession('a', { parent_session_id: null }),
      makeSession('b', { name: 'named-one' }),
    ]
    mockSessionsList.pinnedSessions = ['b']

    render(<SessionsPanel />)

    const tabs = screen.getByTestId('sessions-tabs')
    for (const [filter, label] of [
      ['conversations', 'Conversations'],
      ['named', 'Named'],
      ['pinned', 'Pinned'],
      ['threads', 'Threads'],
      ['subsessions', 'Subsessions'],
      ['all', 'All'],
    ]) {
      const item = screen.getByTestId(`sessions-filter-${filter}`)
      expect(item).toHaveAttribute('title', label)
      expect(item).toHaveAttribute('aria-label', label)
      expect(tabs).not.toHaveTextContent(label)
    }
  })

  it('threads and subsessions read 0 and render the empty-filter message, not a blank area', () => {
    mockSessionsList.sessions = [makeSession('a')]

    mockSessionsList.panelFilter = 'threads'
    const { unmount } = render(<SessionsPanel />)
    expect(screen.getByText('No threads sessions')).toBeInTheDocument()
    unmount()

    mockSessionsList.panelFilter = 'subsessions'
    render(<SessionsPanel />)
    expect(screen.getByText('No subsessions sessions')).toBeInTheDocument()
  })

  it('named filter shows only sessions with a set name', () => {
    mockSessionsList.sessions = [
      makeSession('named-session', { name: 'spike' }),
      makeSession('unnamed-session'),
    ]
    mockSessionsList.panelFilter = 'named'

    render(<SessionsPanel />)

    expect(screen.getAllByTestId('session-item')).toHaveLength(1)
  })

  it('clicking a filter calls setPanelFilter with that filter id', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('a')]

    render(<SessionsPanel />)
    await user.click(screen.getByTestId('sessions-filter-pinned'))

    expect(mockSessionsList.setPanelFilter).toHaveBeenCalledWith('pinned')
  })

  it('sets the fallback to All when the newly-opened session is absent from the picked filter', () => {
    mockSessionsList.sessions = [makeSession('pinned-session'), makeSession('other-session')]
    mockSessionsList.pinnedSessions = ['pinned-session']
    mockSessionsList.panelFilter = 'pinned'
    mockSessionsList.panelFilterPick = 'pinned'
    mockSessionDataCtx.sessionId = 'pinned-session'

    const { rerender } = render(<SessionsPanel />)
    expect(mockSessionsList.setFallbackToAll).not.toHaveBeenCalled()

    mockSessionDataCtx.sessionId = 'other-session'
    rerender(<SessionsPanel />)

    expect(mockSessionsList.setFallbackToAll).toHaveBeenCalledWith(true)
    expect(mockSessionsList.setPanelFilter).not.toHaveBeenCalled()
  })

  it('clears the fallback when a session the picked filter lists is opened', () => {
    mockSessionsList.sessions = [makeSession('pinned-session'), makeSession('other-session')]
    mockSessionsList.pinnedSessions = ['pinned-session']
    mockSessionsList.panelFilter = 'all'
    mockSessionsList.panelFilterPick = 'pinned'
    mockSessionDataCtx.sessionId = 'other-session'

    const { rerender } = render(<SessionsPanel />)
    expect(mockSessionsList.setFallbackToAll).not.toHaveBeenCalled()

    mockSessionDataCtx.sessionId = 'pinned-session'
    rerender(<SessionsPanel />)

    expect(mockSessionsList.setFallbackToAll).toHaveBeenCalledWith(false)
  })

  it('does not move off a hand-chosen filter when the open session merely ceases to be present under it', () => {
    mockSessionsList.sessions = [makeSession('pinned-session')]
    mockSessionsList.pinnedSessions = ['pinned-session']
    mockSessionsList.panelFilter = 'pinned'
    mockSessionsList.panelFilterPick = 'pinned'
    mockSessionDataCtx.sessionId = 'pinned-session'

    const { rerender } = render(<SessionsPanel />)

    // The open session stays the same; only the underlying set changes (unpinned via a refresh).
    mockSessionsList.pinnedSessions = []
    rerender(<SessionsPanel />)

    expect(mockSessionsList.setFallbackToAll).not.toHaveBeenCalled()
  })
})

describe('SessionsPanel search', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('renders the search toggle between the new-session chevron and refresh', () => {
    mockSessionsList.sessions = [makeSession('a')]
    render(<SessionsPanel />)

    const buttons = screen.getByTestId('panel-sessions').querySelectorAll('button')
    const testIds = Array.from(buttons).map(b => b.dataset.testid)
    const chevronIndex = testIds.indexOf('session-new-session-chevron')
    const searchIndex = testIds.indexOf('sessions-search-toggle')
    const refreshIndex = testIds.indexOf('session-refresh-btn')

    expect(chevronIndex).toBeGreaterThanOrEqual(0)
    expect(searchIndex).toBeGreaterThan(chevronIndex)
    expect(refreshIndex).toBeGreaterThan(searchIndex)
  })

  it('opening search hides the filter icons and focuses the box; the toggle itself hides too', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('a')]
    render(<SessionsPanel />)

    await user.click(screen.getByTestId('sessions-search-toggle'))

    expect(screen.queryByTestId('sessions-tabs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sessions-search-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('sessions-search-input')).toHaveFocus()
  })

  it('matches a session by name, case-insensitively, across every session regardless of the active filter', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [
      makeSession('a', { name: 'Parser Rewrite' }),
      makeSession('b', { name: 'unrelated' }),
    ]
    mockSessionsList.pinnedSessions = ['b']
    mockSessionsList.panelFilter = 'pinned'
    render(<SessionsPanel />)

    await user.click(screen.getByTestId('sessions-search-toggle'))
    await user.type(screen.getByTestId('sessions-search-input'), 'PARSER')

    const items = screen.getAllByTestId('session-item')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Parser Rewrite')
  })

  it('matches a session by a pasted full id, not only the eight characters the row shows', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('abcdef1234567890', { name: null })]
    render(<SessionsPanel />)

    await user.click(screen.getByTestId('sessions-search-toggle'))
    await user.type(screen.getByTestId('sessions-search-input'), 'abcdef1234567890')

    expect(screen.getAllByTestId('session-item')).toHaveLength(1)
  })

  it('shows a message, not a blank area, when nothing matches', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('a', { name: 'spike' })]
    render(<SessionsPanel />)

    await user.click(screen.getByTestId('sessions-search-toggle'))
    await user.type(screen.getByTestId('sessions-search-input'), 'nothing matches this')

    expect(screen.queryByTestId('session-item')).not.toBeInTheDocument()
    expect(screen.getByText(/no sessions match/i)).toBeInTheDocument()
  })

  it('Escape closes the box and restores the filter icons without changing the chosen filter', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('a', { name: 'spike' })]
    mockSessionsList.panelFilter = 'named'
    render(<SessionsPanel />)

    await user.click(screen.getByTestId('sessions-search-toggle'))
    await user.type(screen.getByTestId('sessions-search-input'), 'spike')
    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('sessions-search-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('sessions-tabs')).toBeInTheDocument()
    expect(mockSessionsList.setPanelFilter).not.toHaveBeenCalled()
  })

  it('blurring an empty box closes it; blurring a non-empty one leaves it open', async () => {
    const user = userEvent.setup()
    mockSessionsList.sessions = [makeSession('a', { name: 'spike' })]
    render(<SessionsPanel />)

    await user.click(screen.getByTestId('sessions-search-toggle'))
    const input = screen.getByTestId('sessions-search-input')
    await user.click(input)
    fireEvent.blur(input)
    expect(screen.queryByTestId('sessions-search-input')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('sessions-search-toggle'))
    await user.type(screen.getByTestId('sessions-search-input'), 'spike')
    fireEvent.blur(screen.getByTestId('sessions-search-input'))
    expect(screen.getByTestId('sessions-search-input')).toBeInTheDocument()
  })
})
