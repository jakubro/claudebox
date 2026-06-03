/** Tests for MobileDrawer component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MobileDrawer from './MobileDrawer'

// Mock lucide-react — covers MobileDrawer's own icons and SessionItem's icons
// (SessionItem renders as a child on mobile).
vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check">✓</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">▾</span>,
  Loader2: () => <span data-testid="icon-loader">⟳</span>,
  Pencil: () => <span data-testid="icon-pencil">✎</span>,
  Pin: () => <span data-testid="icon-pin">📌</span>,
  Play: () => <span data-testid="icon-play">▶</span>,
  Plus: () => <span data-testid="icon-plus">+</span>,
  Square: () => <span data-testid="icon-square">□</span>,
  X: () => <span data-testid="icon-x">x</span>,
}))

// Mock SessionItem's own API import (sessions update path).
vi.mock('../../../../api/sessions', () => ({
  updateSession: vi.fn(() => Promise.resolve()),
}))

// Mock API
const mockDeleteContainer = vi.fn(() => Promise.resolve())
vi.mock('../../../../api/containers', () => ({
  deleteContainer: (...args) => mockDeleteContainer(...args),
}))

// Mock contexts
const mockSessionsCtx = {
  sessions: [
    { session_id: 'sess-1', name: 'First Session', container_id: 'c-1' },
    { session_id: 'sess-2', name: 'Second Session', container_id: 'c-2' },
  ],
}
vi.mock('../../../../context/SessionsContext', () => ({
  useSessionsList: () => mockSessionsCtx,
}))

const mockSessionDataCtx = { sessionId: 'sess-1' }
vi.mock('../../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
}))

const mockWorkspaceCtx = {
  workspaceId: 'ws-1',
  workspaces: [{ id: 'ws-1' }],
  selectWorkspace: vi.fn(),
}
vi.mock('../../../../context/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspaceCtx,
}))

const mockSessionRoutingCtx = {
  navigateToSession: vi.fn(),
  navigateToWorkspace: vi.fn(),
}
vi.mock('../../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => mockSessionRoutingCtx,
}))

const mockContainerMapCtx = {
  containerMap: { 'sess-1': 'c-1', 'sess-2': 'c-2' },
  stoppingSessions: new Set(),
  addStoppingSession: vi.fn(),
  removeSessionContainer: vi.fn(),
  deriveSessionStatus: (_sessionId, _sessions, fallbackContainerId = null) =>
    fallbackContainerId ? 'running' : 'none',
}
vi.mock('../../../../context/ContainerMapContext', () => ({
  useContainerMap: () => mockContainerMapCtx,
}))

const mockEventsCtx = { isConnected: true }
vi.mock('../../../../context/EventsContext', () => ({
  useEvents: () => mockEventsCtx,
}))

const mockExecuteNewSession = vi.fn()
const mockNewSessionHook = { executeNewSession: mockExecuteNewSession, isCreating: false }
vi.mock('../../../../hooks/useNewSession', () => ({
  default: () => mockNewSessionHook,
}))

describe('MobileDrawer', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    onClose.mockReset()
    mockDeleteContainer.mockReset()
    mockDeleteContainer.mockResolvedValue(undefined)
    mockExecuteNewSession.mockReset()
    mockWorkspaceCtx.selectWorkspace.mockReset()
    mockSessionRoutingCtx.navigateToSession.mockReset()
    mockSessionRoutingCtx.navigateToWorkspace.mockReset()
    mockContainerMapCtx.addStoppingSession.mockReset()
    mockContainerMapCtx.removeSessionContainer.mockReset()

    mockSessionsCtx.sessions = [
      { session_id: 'sess-1', name: 'First Session', container_id: 'c-1' },
      { session_id: 'sess-2', name: 'Second Session', container_id: 'c-2' },
    ]
    mockSessionDataCtx.sessionId = 'sess-1'
    mockWorkspaceCtx.workspaceId = 'ws-1'
    mockWorkspaceCtx.workspaces = [{ id: 'ws-1' }]
    mockContainerMapCtx.containerMap = { 'sess-1': 'c-1', 'sess-2': 'c-2' }
    mockEventsCtx.isConnected = true
    mockNewSessionHook.isCreating = false
  })

  it('renders session list', () => {
    render(<MobileDrawer onClose={onClose} />)

    expect(screen.getByText('First Session')).toBeInTheDocument()
    expect(screen.getByText('Second Session')).toBeInTheDocument()
  })

  it('clicking a session calls navigateToSession and onClose', async () => {
    const user = userEvent.setup()

    render(<MobileDrawer onClose={onClose} />)

    await user.click(screen.getByText('Second Session'))

    expect(mockSessionRoutingCtx.navigateToSession).toHaveBeenCalledWith('ws-1', 'sess-2')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('new session button calls executeNewSession and onClose', async () => {
    const user = userEvent.setup()

    render(<MobileDrawer onClose={onClose} />)

    await user.click(screen.getByText('New session'))

    expect(mockExecuteNewSession).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('overlay click calls onClose', async () => {
    const user = userEvent.setup()

    const { container } = render(<MobileDrawer onClose={onClose} />)

    const overlay = container.querySelector('.mobile-drawer-overlay')
    await user.click(overlay)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clicking inside drawer does not call onClose', async () => {
    const user = userEvent.setup()

    const { container } = render(<MobileDrawer onClose={onClose} />)

    const drawer = container.querySelector('.mobile-drawer')
    await user.click(drawer)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('close session button triggers container deletion', async () => {
    const user = userEvent.setup()

    render(<MobileDrawer onClose={onClose} />)

    await user.click(screen.getByText('Close session'))

    expect(mockContainerMapCtx.addStoppingSession).toHaveBeenCalledWith('sess-1')
    expect(mockDeleteContainer).toHaveBeenCalledWith('c-1')
    expect(mockContainerMapCtx.removeSessionContainer).toHaveBeenCalledWith('sess-1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('close session button is disabled when not connected', () => {
    mockEventsCtx.isConnected = false

    render(<MobileDrawer onClose={onClose} />)

    expect(screen.getByText('Close session').closest('button')).toBeDisabled()
  })

  it('close session button is disabled when no current session', () => {
    mockSessionDataCtx.sessionId = null

    render(<MobileDrawer onClose={onClose} />)

    expect(screen.getByText('Close session').closest('button')).toBeDisabled()
  })

  it('falls back to session_id prefix when name is missing', () => {
    mockSessionsCtx.sessions = [{ session_id: 'abcdefgh-1234', name: '', container_id: 'c-3' }]

    render(<MobileDrawer onClose={onClose} />)

    expect(screen.getByText('abcdefgh')).toBeInTheDocument()
  })

  it('does not render workspace switcher with single workspace', () => {
    render(<MobileDrawer onClose={onClose} />)

    expect(screen.queryByText('Workspaces')).not.toBeInTheDocument()
  })

  it('renders workspace switcher with multiple workspaces', () => {
    mockWorkspaceCtx.workspaces = [{ id: 'ws-1' }, { id: 'ws-2' }]

    render(<MobileDrawer onClose={onClose} />)

    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('ws-2')).toBeInTheDocument()
  })

  it('top X close button calls onClose', async () => {
    const user = userEvent.setup()

    render(<MobileDrawer onClose={onClose} />)

    await user.click(screen.getByTitle('Close menu'))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
