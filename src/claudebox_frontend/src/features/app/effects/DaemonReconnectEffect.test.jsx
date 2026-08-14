/** Tests for DaemonReconnectEffect - daemon reconnect recovery logic. */

import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DaemonReconnectEffect from './DaemonReconnectEffect'

const mockDaemonStream = { daemonReconnected: 0 }
vi.mock('../../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => mockDaemonStream,
}))

const mockRouting = { activeSessionId: 'sess-1' }
vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => mockRouting,
}))

const mockEvents = {
  reconnectSSE: vi.fn(),
  startResume: vi.fn(),
  clearResume: vi.fn(),
  notifyContainerChanged: vi.fn(),
  containerId: 'ctr-1',
  isConnected: true,
}
vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => mockEvents,
}))

const mockContainerMap = { setSessionContainer: vi.fn(), stoppingSessions: new Set() }
vi.mock('../../../context/ContainerMapContext', () => ({
  useContainerMap: () => mockContainerMap,
}))

const mockSessionActions = { clearSessionData: vi.fn() }
vi.mock('../../../context/SessionDataContext', () => ({
  useSessionActions: () => mockSessionActions,
}))

const mockInteraction = { setError: vi.fn() }
vi.mock('../../../context/InteractionContext', () => ({
  useInteraction: () => mockInteraction,
}))

const mockSetContainerId = vi.fn()
vi.mock('../../../api/apiClient', () => ({
  setContainerId: (...args) => mockSetContainerId(...args),
}))

const mockResumeSession = vi.fn()
vi.mock('../../../api/sessions', () => ({
  resumeSession: (...args) => mockResumeSession(...args),
}))

describe('DaemonReconnectEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDaemonStream.daemonReconnected = 0
    mockRouting.activeSessionId = 'sess-1'
    mockEvents.containerId = 'ctr-1'
    mockEvents.isConnected = true
    mockContainerMap.stoppingSessions = new Set()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Render the effect, then re-render with incremented daemonReconnected. */
  function renderAndReconnect(overrides = {}) {
    // Apply overrides before initial render
    Object.assign(mockDaemonStream, overrides.daemon || {})
    Object.assign(mockRouting, overrides.routing || {})
    Object.assign(mockEvents, overrides.events || {})

    const { rerender } = render(<DaemonReconnectEffect />)

    mockDaemonStream.daemonReconnected = (overrides.daemon?.daemonReconnected || 0) + 1
    rerender(<DaemonReconnectEffect />)

    return { rerender }
  }

  it('recovers session when daemon restarts while session is active', async () => {
    // Container SSE is dead (daemon restart killed it)
    mockResumeSession.mockResolvedValue({ container_id: 'fresh-ctr' })

    renderAndReconnect({
      events: { ...mockEvents, containerId: null, isConnected: false },
    })

    await vi.waitFor(() => {
      expect(mockResumeSession).toHaveBeenCalledWith('sess-1')
    })

    expect(mockSetContainerId).toHaveBeenCalledWith('fresh-ctr')
    expect(mockEvents.notifyContainerChanged).toHaveBeenCalled()
    expect(mockEvents.reconnectSSE).toHaveBeenCalled()
  })

  it('does not resurrect a session the user stopped (stopped-intent guard)', () => {
    // The session is mid-stop; a daemon reconnect must NOT spawn a fresh container.
    mockContainerMap.stoppingSessions = new Set(['sess-1'])

    renderAndReconnect({
      events: { ...mockEvents, containerId: null, isConnected: false },
    })

    expect(mockResumeSession).not.toHaveBeenCalled()
    expect(mockEvents.startResume).not.toHaveBeenCalled()
  })

  it('fires recovery only when daemonReconnected increments', () => {
    // Container SSE alive; first render (daemonReconnected=0) should trigger nothing.
    const { rerender } = render(<DaemonReconnectEffect />)

    expect(mockResumeSession).not.toHaveBeenCalled()
    expect(mockEvents.startResume).not.toHaveBeenCalled()

    // Same value re-render - still no action
    rerender(<DaemonReconnectEffect />)
    expect(mockEvents.startResume).not.toHaveBeenCalled()

    // Increment triggers the effect, which skips resume because container SSE survived.
    mockDaemonStream.daemonReconnected = 1
    rerender(<DaemonReconnectEffect />)

    expect(mockResumeSession).not.toHaveBeenCalled()
  })

  it('skips re-resume if container SSE survived the daemon restart', () => {
    renderAndReconnect({
      events: { ...mockEvents, containerId: 'ctr-1', isConnected: true },
    })

    expect(mockEvents.startResume).not.toHaveBeenCalled()
    expect(mockResumeSession).not.toHaveBeenCalled()
    expect(mockEvents.reconnectSSE).not.toHaveBeenCalled()
  })

  it('calls resume for fresh container ID when container SSE is dead', async () => {
    mockResumeSession.mockResolvedValue({ container_id: 'new-ctr-42' })

    renderAndReconnect({
      events: { ...mockEvents, containerId: null, isConnected: false },
    })

    await vi.waitFor(() => {
      expect(mockResumeSession).toHaveBeenCalledWith('sess-1')
    })

    // Verify full recovery sequence
    expect(mockEvents.clearResume).toHaveBeenCalled()
    expect(mockEvents.startResume).toHaveBeenCalled()
    expect(mockSetContainerId).toHaveBeenCalledWith('new-ctr-42')
    expect(mockContainerMap.setSessionContainer).toHaveBeenCalledWith('sess-1', 'new-ctr-42')
    expect(mockEvents.notifyContainerChanged).toHaveBeenCalled()
    expect(mockSessionActions.clearSessionData).toHaveBeenCalled()
    expect(mockEvents.reconnectSSE).toHaveBeenCalled()
  })

  it('shows error on resume failure', async () => {
    mockResumeSession.mockRejectedValue(new Error('network error'))

    renderAndReconnect({
      events: { ...mockEvents, containerId: null, isConnected: false },
    })

    await vi.waitFor(() => {
      expect(mockInteraction.setError).toHaveBeenCalledWith('Session reconnect failed')
    })

    expect(mockEvents.clearResume).toHaveBeenCalled()
    expect(mockEvents.reconnectSSE).not.toHaveBeenCalled()
  })

  it('does not resume when no active session', () => {
    renderAndReconnect({
      routing: { activeSessionId: null },
      events: { ...mockEvents, containerId: null, isConnected: false },
    })

    expect(mockResumeSession).not.toHaveBeenCalled()
    expect(mockEvents.startResume).not.toHaveBeenCalled()
  })
})
