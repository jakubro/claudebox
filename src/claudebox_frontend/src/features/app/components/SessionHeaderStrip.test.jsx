/** Tests for SessionHeaderStrip - header chrome above chat with status dot, name, Stop, +, switcher. */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockSessionData = { sessionId: null, sessionName: null }
let mockEvents = { isResponding: false, isCreating: false, containerId: null }
let mockContainerMap = { containerMap: {}, stoppingSessions: new Set() }
let mockSessions = []
let mockActiveSessionId = null
let mockActiveBoardId = null
let mockActiveWorkspaceId = null
let mockWorkspaceId = 'ws-1'
let mockBoard = null
let mockAddStoppingSession = vi.fn()
let mockRemoveSessionContainer = vi.fn()
let mockRefresh = vi.fn()
let mockFocusChat = vi.fn()
let mockMaximizeToggle = vi.fn()
let mockDeleteContainer = vi.fn(() => Promise.resolve())

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionData,
  useSessionDir: () => mockSessionDir,
}))

let mockSessionDir = null

vi.mock('../../../hooks/useCopyFlash', () => ({
  default: () => [mockCopiedRef.current, mockCopy],
}))

const mockCopiedRef = { current: false }
const mockCopy = vi.fn()

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => mockEvents,
}))

vi.mock('../../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    ...mockContainerMap,
    addStoppingSession: mockAddStoppingSession,
    removeSessionContainer: mockRemoveSessionContainer,
    deriveSessionStatus: (sessionId, sessions = []) => {
      if (mockContainerMap.stoppingSessions.has(sessionId)) {
        return 'stopping'
      }
      const cid =
        mockContainerMap.containerMap[sessionId] ??
        sessions.find(s => s.session_id === sessionId)?.container_id
      return cid ? 'running' : 'none'
    },
  }),
}))

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions, refresh: mockRefresh }),
}))

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    activeSessionId: mockActiveSessionId,
    activeBoardId: mockActiveBoardId,
    activeWorkspaceId: mockActiveWorkspaceId,
    clearActiveSession: vi.fn(),
  }),
}))

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: mockWorkspaceId }),
}))

vi.mock('../../boards/hooks/useBoardData', () => ({
  default: () => ({ board: mockBoard, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('../../../context/AppActionsContext', () => ({
  useAppActions: () => ({ focusChatTab: mockFocusChat, maximizeToggle: mockMaximizeToggle }),
}))

vi.mock('../../../api/containers', () => ({
  deleteContainer: (...args) => mockDeleteContainer(...args),
}))

vi.mock('../../../components/NewSessionSplitButton', () => ({
  default: ({ dataTestIdPrefix }) => (
    <div data-testid={`${dataTestIdPrefix}-new-session-mock`}>+</div>
  ),
}))

vi.mock('./WorkspaceSwitcher', () => ({
  default: () => <div data-testid="workspace-switcher-mock">ws</div>,
}))

import SessionHeaderStrip from './SessionHeaderStrip.jsx'

describe('SessionHeaderStrip', () => {
  beforeEach(() => {
    mockSessionData = { sessionId: null, sessionName: null }
    mockEvents = { isResponding: false, isCreating: false, containerId: null }
    mockContainerMap = { containerMap: {}, stoppingSessions: new Set() }
    mockSessions = []
    mockActiveSessionId = null
    mockActiveBoardId = null
    mockActiveWorkspaceId = null
    mockBoard = null
    mockWorkspaceId = 'ws-1'
    mockAddStoppingSession = vi.fn()
    mockRemoveSessionContainer = vi.fn()
    mockRefresh = vi.fn()
    mockFocusChat = vi.fn()
    mockMaximizeToggle = vi.fn()
    mockSessionDir = null
    mockCopiedRef.current = false
    mockCopy.mockClear()
    mockDeleteContainer = vi.fn(() => Promise.resolve())
  })

  it('renders the strip with right-slot controls in welcome state', () => {
    render(<SessionHeaderStrip />)

    expect(screen.getByTestId('session-header-strip')).toBeInTheDocument()
    expect(screen.getByTestId('header-new-session-mock')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-switcher-mock')).toBeInTheDocument()

    // Left slot empty
    expect(screen.queryByTestId('session-header-status-dot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-header-session-name')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-header-stop-btn')).not.toBeInTheDocument()
  })

  it('renders Creating… spinner during creation', () => {
    mockEvents = { ...mockEvents, isCreating: true }

    render(<SessionHeaderStrip />)

    expect(screen.getByText('Creating…')).toBeInTheDocument()
    expect(screen.queryByTestId('session-header-status-dot')).not.toBeInTheDocument()
  })

  it('renders status dot, name, and Stop button when session is active with running container', () => {
    mockSessionData = { sessionId: 'sess-1', sessionName: 'My session' }
    mockActiveSessionId = 'sess-1'
    mockContainerMap = { containerMap: { 'sess-1': 'container-1' }, stoppingSessions: new Set() }

    render(<SessionHeaderStrip />)

    const dot = screen.getByTestId('session-header-status-dot')
    expect(dot).toHaveAttribute('data-status', 'running')

    const name = screen.getByTestId('session-header-session-name')
    expect(name).toHaveTextContent('My session')

    expect(screen.getByTestId('session-header-stop-btn')).toBeInTheDocument()
  })

  it('renders the board info in the LEFT slot when activeBoardId is set and workspace matches', () => {
    mockActiveBoardId = 'board-1'
    mockActiveWorkspaceId = 'ws-1'
    mockWorkspaceId = 'ws-1'
    mockBoard = { id: 'board-1', name: 'Sprint Board', path: '/repo/board.yaml' }

    render(<SessionHeaderStrip />)

    const boardName = screen.getByTestId('board-header')
    expect(boardName).toHaveTextContent('Sprint Board')
    // No session-side trio at the same time.
    expect(screen.queryByTestId('session-header-status-dot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-header-session-name')).not.toBeInTheDocument()
  })

  it('clicking the board name copies the board path', async () => {
    mockActiveBoardId = 'board-1'
    mockActiveWorkspaceId = 'ws-1'
    mockWorkspaceId = 'ws-1'
    mockBoard = { id: 'board-1', name: 'Sprint Board', path: '/repo/board.yaml' }

    const user = userEvent.setup()
    render(<SessionHeaderStrip />)

    await user.click(screen.getByTestId('board-header'))
    expect(mockCopy).toHaveBeenCalledWith('/repo/board.yaml')
  })

  it('falls back to the session trio when board view applies to a different workspace', () => {
    // Mismatched workspace - board info should not yet render (waits for workspace catch-up).
    mockActiveBoardId = 'board-1'
    mockActiveWorkspaceId = 'ws-2'
    mockWorkspaceId = 'ws-1'
    mockSessionData = { sessionId: 'sess-1', sessionName: 'My session' }
    mockActiveSessionId = 'sess-1'
    mockContainerMap = { containerMap: { 'sess-1': 'container-1' }, stoppingSessions: new Set() }
    mockBoard = { id: 'board-1', name: 'Sprint Board', path: '/repo/board.yaml' }

    render(<SessionHeaderStrip />)

    expect(screen.queryByTestId('board-header')).not.toBeInTheDocument()
    expect(screen.getByTestId('session-header-status-dot')).toBeInTheDocument()
    expect(screen.getByTestId('session-header-session-name')).toBeInTheDocument()
  })

  it('renders amber dot when session is stopping', () => {
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'
    mockContainerMap = {
      containerMap: { 'sess-1': 'container-1' },
      stoppingSessions: new Set(['sess-1']),
    }

    render(<SessionHeaderStrip />)

    expect(screen.getByTestId('session-header-status-dot')).toHaveAttribute(
      'data-status',
      'stopping',
    )
  })

  it('renders gray dot and hides Stop button when no container present', () => {
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'

    render(<SessionHeaderStrip />)

    expect(screen.getByTestId('session-header-status-dot')).toHaveAttribute('data-status', 'none')
    expect(screen.queryByTestId('session-header-stop-btn')).not.toBeInTheDocument()
  })

  it('Stop button - idle stops silently, no modal', async () => {
    const user = userEvent.setup()
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'
    mockContainerMap = { containerMap: { 'sess-1': 'container-1' }, stoppingSessions: new Set() }

    render(<SessionHeaderStrip />)

    await user.click(screen.getByTestId('session-header-stop-btn'))

    expect(screen.queryByTestId('confirm-stop-modal')).not.toBeInTheDocument()
    expect(mockAddStoppingSession).toHaveBeenCalledWith('sess-1')
    expect(mockDeleteContainer).toHaveBeenCalledWith('container-1')
  })

  it('Stop button - responding shows confirm modal; Cancel keeps response running', async () => {
    const user = userEvent.setup()
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'
    mockEvents = { ...mockEvents, isResponding: true }
    mockContainerMap = { containerMap: { 'sess-1': 'container-1' }, stoppingSessions: new Set() }

    render(<SessionHeaderStrip />)

    await user.click(screen.getByTestId('session-header-stop-btn'))
    expect(screen.getByTestId('confirm-stop-modal')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-stop-modal-detail')).toHaveTextContent(
      'Stopping the session will end the response',
    )

    await user.click(screen.getByTestId('confirm-stop-modal-cancel'))
    expect(mockDeleteContainer).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-stop-modal')).not.toBeInTheDocument()
  })

  it('Stop button - responding + Continue stops the container', async () => {
    const user = userEvent.setup()
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'
    mockEvents = { ...mockEvents, isResponding: true }
    mockContainerMap = { containerMap: { 'sess-1': 'container-1' }, stoppingSessions: new Set() }

    render(<SessionHeaderStrip />)

    await user.click(screen.getByTestId('session-header-stop-btn'))
    await user.click(screen.getByTestId('confirm-stop-modal-confirm'))

    expect(mockDeleteContainer).toHaveBeenCalledWith('container-1')
    expect(screen.queryByTestId('confirm-stop-modal')).not.toBeInTheDocument()
  })

  it('clicking the session name copies the session directory', async () => {
    const user = userEvent.setup()
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'
    mockSessionDir = '/tmp/sessions/abc'
    mockContainerMap = { containerMap: { 'sess-1': 'container-1' }, stoppingSessions: new Set() }
    mockCopy.mockClear()

    render(<SessionHeaderStrip />)

    await user.click(screen.getByTestId('session-header-session-name'))
    expect(mockCopy).toHaveBeenCalledWith('/tmp/sessions/abc')
  })

  it('session name tooltip is the unified Session directory string', () => {
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'
    mockSessionDir = '/tmp/sessions/abc'
    mockContainerMap = { containerMap: { 'sess-1': 'container-1' }, stoppingSessions: new Set() }

    render(<SessionHeaderStrip />)

    expect(screen.getByTestId('session-header-session-name')).toHaveAttribute(
      'title',
      'Session directory - /tmp/sessions/abc',
    )
  })

  it('falls back to truncated session id when name is missing', () => {
    mockSessionData = { sessionId: 'abcdef0123456789', sessionName: null }
    mockActiveSessionId = 'abcdef0123456789'

    render(<SessionHeaderStrip />)

    expect(screen.getByTestId('session-header-session-name')).toHaveTextContent('abcdef01')
  })

  it('falls back to sessions list container_id when containerMap is empty', () => {
    mockSessionData = { sessionId: 'sess-1', sessionName: 'X' }
    mockActiveSessionId = 'sess-1'
    mockSessions = [{ session_id: 'sess-1', container_id: 'fallback-container' }]

    render(<SessionHeaderStrip />)

    // Stop button is visible because hasContainer resolved via fallback.
    expect(screen.getByTestId('session-header-stop-btn')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('session-header-stop-btn'))
    expect(mockDeleteContainer).toHaveBeenCalledWith('fallback-container')
  })
})
