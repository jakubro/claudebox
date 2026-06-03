/** Tests for BookmarksPanel component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock hooks
let mockSessionId = 'test-session'
let mockAllBookmarks = {}
let mockBookmarkMeta = {}
let mockLoading = false
let mockToggleBookmark = vi.fn()
let mockRemoveBookmark = vi.fn()
let mockSessions = []

vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => ({
    markUserIntentRef: { current: null },
    markProgrammaticScrollRef: { current: null },
  }),
}))

vi.mock('../../context/SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: mockSessionId }),
}))

vi.mock('../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    stoppingSessions: new Set(),
    deriveSessionStatus: (sessionId, sessions = []) =>
      sessions.find(s => s.session_id === sessionId)?.container_id ? 'running' : 'none',
  }),
}))

vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ navigateToSession: vi.fn() }),
}))

vi.mock('../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions }),
}))

vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'ws-1' }),
}))

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => ({ isResponding: false }),
}))

vi.mock('../../context/StillRunningToastContext', () => ({
  useStillRunningToast: () => ({
    toast: null,
    showStillRunningToast: vi.fn(),
    dismissStillRunningToast: vi.fn(),
  }),
}))

vi.mock('../../context/BookmarksContext', () => ({
  useBookmarksContext: () => ({
    bookmarkedMessageIds: new Set(),
    allBookmarks: mockAllBookmarks,
    bookmarkMeta: mockBookmarkMeta,
    loading: mockLoading,
    error: null,
    toggleBookmark: mockToggleBookmark,
    removeBookmark: mockRemoveBookmark,
    refresh: vi.fn(),
  }),
}))

import BookmarksPanel from './BookmarksPanel'

describe('BookmarksPanel', () => {
  beforeEach(() => {
    mockSessionId = 'test-session'
    mockAllBookmarks = {}
    mockBookmarkMeta = {}
    mockLoading = false
    mockToggleBookmark = vi.fn()
    mockRemoveBookmark = vi.fn()
    mockSessions = []
  })

  it('renders panel-level loading placeholder during cold load — no tabs, no false-empty', () => {
    mockLoading = true

    render(<BookmarksPanel />)

    const panel = screen.getByTestId('panel-bookmarks')
    expect(panel).toHaveClass('bookmarks-loading')
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('No bookmarks')).not.toBeInTheDocument()
    expect(screen.queryByText('This session')).not.toBeInTheDocument()
    expect(screen.queryByText('All sessions')).not.toBeInTheDocument()
  })

  it('renders empty state for session tab', () => {
    render(<BookmarksPanel />)

    expect(screen.getByText('No bookmarks')).toBeInTheDocument()
  })

  it('renders session bookmarks with preview text', () => {
    mockAllBookmarks = { 'test-session': ['turn-a:user'] }
    mockBookmarkMeta = {
      'test-session/turn-a:user': { preview: 'Hello world', ts: '2026-01-01T00:00:00Z' },
    }

    render(<BookmarksPanel />)

    expect(screen.getByText('Hello world')).toBeInTheDocument()
    // No type label should be rendered
    expect(screen.queryByText('user')).not.toBeInTheDocument()
  })

  it('renders assistant bookmark without type label', () => {
    mockAllBookmarks = { 'test-session': ['turn-a:assistant'] }
    mockBookmarkMeta = {
      'test-session/turn-a:assistant': { preview: 'Response text', ts: '2026-01-01T00:00:00Z' },
    }

    render(<BookmarksPanel />)

    expect(screen.getByText('Response text')).toBeInTheDocument()
    expect(screen.queryByText('assistant')).not.toBeInTheDocument()
  })

  it('shows remove button on bookmark items', () => {
    mockAllBookmarks = { 'test-session': ['turn-a:user'] }
    mockBookmarkMeta = {
      'test-session/turn-a:user': { preview: 'Hello', ts: '2026-01-01T00:00:00Z' },
    }

    render(<BookmarksPanel />)

    expect(screen.getByTitle('Remove bookmark')).toBeInTheDocument()
  })

  it('calls toggleBookmark with turnId and messageType on remove', () => {
    mockAllBookmarks = { 'test-session': ['turn-a:user'] }
    mockBookmarkMeta = {
      'test-session/turn-a:user': { preview: 'Hello', ts: '2026-01-01T00:00:00Z' },
    }

    render(<BookmarksPanel />)

    fireEvent.click(screen.getByTitle('Remove bookmark'))

    expect(mockToggleBookmark).toHaveBeenCalledWith('turn-a', 'user')
  })

  it('renders all sessions tab with empty state', () => {
    render(<BookmarksPanel />)

    fireEvent.click(screen.getByText('All sessions'))

    expect(screen.getByText('No bookmarks')).toBeInTheDocument()
  })

  it('renders all sessions tab with bookmarks from multiple sessions', () => {
    mockAllBookmarks = {
      'session-1': ['turn-a:user'],
      'session-2': ['turn-b:assistant'],
    }
    mockBookmarkMeta = {
      'session-1/turn-a:user': { preview: 'First', ts: '2026-01-01T00:01:00Z' },
      'session-2/turn-b:assistant': { preview: 'Second', ts: '2026-01-01T00:00:00Z' },
    }
    mockSessions = [
      { session_id: 'session-1', name: 'Session One' },
      { session_id: 'session-2', name: 'Session Two' },
    ]

    render(<BookmarksPanel />)
    fireEvent.click(screen.getByText('All sessions'))

    expect(screen.getByText('Session One')).toBeInTheDocument()
    expect(screen.getByText('Session Two')).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('shows tab counts', () => {
    mockAllBookmarks = {
      'test-session': ['turn-a:user', 'turn-b:assistant'],
      'other-session': ['turn-c:user'],
    }
    mockBookmarkMeta = {
      'test-session/turn-a:user': { preview: 'A', ts: '2026-01-01' },
      'test-session/turn-b:assistant': { preview: 'B', ts: '2026-01-01' },
      'other-session/turn-c:user': { preview: 'C', ts: '2026-01-01' },
    }

    render(<BookmarksPanel />)

    // "This session" tab should show count 2
    expect(screen.getByText('2')).toBeInTheDocument()
    // "All sessions" tab should show count 3
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('falls back to truncated turnId when no preview', () => {
    mockAllBookmarks = { 'test-session': ['abcdefghijklmnop:user'] }
    mockBookmarkMeta = {}

    render(<BookmarksPanel />)

    expect(screen.getByText('abcdefgh')).toBeInTheDocument()
  })

  it('shows both user and assistant bookmarks independently', () => {
    mockAllBookmarks = { 'test-session': ['turn-a:user', 'turn-a:assistant'] }
    mockBookmarkMeta = {
      'test-session/turn-a:user': { preview: 'User msg', ts: '2026-01-01T00:00:00Z' },
      'test-session/turn-a:assistant': { preview: 'Asst response', ts: '2026-01-01T00:00:01Z' },
    }

    render(<BookmarksPanel />)

    expect(screen.getByText('User msg')).toBeInTheDocument()
    expect(screen.getByText('Asst response')).toBeInTheDocument()
    expect(screen.getAllByTestId('bookmark-item')).toHaveLength(2)
  })

  it('calls removeBookmark for all-sessions tab entries', () => {
    mockAllBookmarks = { 'other-session': ['turn-x:user'] }
    mockBookmarkMeta = {
      'other-session/turn-x:user': { preview: 'Other msg', ts: '2026-01-01T00:00:00Z' },
    }
    mockSessions = [{ session_id: 'other-session', name: 'Other' }]

    render(<BookmarksPanel />)
    fireEvent.click(screen.getByText('All sessions'))

    fireEvent.click(screen.getByTitle('Remove bookmark'))

    expect(mockRemoveBookmark).toHaveBeenCalledWith('other-session', 'turn-x', 'user')
  })

  describe('reactive tab default', () => {
    it('defaults to "All sessions" when no session is active on cold open', () => {
      mockSessionId = null

      render(<BookmarksPanel />)

      // PanelListItem renders both labels; the active one is marked.
      const allTab = screen.getByText('All sessions').closest('button, [role="button"], div')
      const sessionTab = screen.getByText('This session').closest('button, [role="button"], div')
      expect(allTab.className).toMatch(/active/)
      expect(sessionTab.className).not.toMatch(/active/)
    })

    it('defaults to "This session" when a session is active on cold open', () => {
      mockSessionId = 'sess-A'

      render(<BookmarksPanel />)

      const sessionTab = screen.getByText('This session').closest('button, [role="button"], div')
      expect(sessionTab.className).toMatch(/active/)
    })

    it('auto-switches to "This session" when sessionId becomes truthy after mount', () => {
      mockSessionId = null
      const { rerender } = render(<BookmarksPanel />)

      mockSessionId = 'sess-B'
      rerender(<BookmarksPanel />)

      const sessionTab = screen.getByText('This session').closest('button, [role="button"], div')
      expect(sessionTab.className).toMatch(/active/)
    })

    it('auto-switches to "All sessions" when last session closes', () => {
      mockSessionId = 'sess-A'
      const { rerender } = render(<BookmarksPanel />)

      mockSessionId = null
      rerender(<BookmarksPanel />)

      const allTab = screen.getByText('All sessions').closest('button, [role="button"], div')
      expect(allTab.className).toMatch(/active/)
    })

    it('auto-switch overrides a manual click on the next session-state change', () => {
      // Active session, user picks "All sessions" manually.
      mockSessionId = 'sess-A'
      const { rerender } = render(<BookmarksPanel />)
      fireEvent.click(screen.getByText('All sessions'))
      const allTab = screen.getByText('All sessions').closest('button, [role="button"], div')
      expect(allTab.className).toMatch(/active/)

      // Session changes — auto-switch wins, tab returns to "This session".
      mockSessionId = 'sess-B'
      rerender(<BookmarksPanel />)

      const sessionTab = screen.getByText('This session').closest('button, [role="button"], div')
      expect(sessionTab.className).toMatch(/active/)
    })
  })
})
