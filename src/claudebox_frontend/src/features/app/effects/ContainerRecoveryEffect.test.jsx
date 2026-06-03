/** Tests for ContainerRecoveryEffect — container SSE reconnect recovery. */

import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContainerRecoveryEffect from './ContainerRecoveryEffect'

// --- Mock all context hooks ---

const mockRouting = { activeSessionId: 'sess-1' }
vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => mockRouting,
}))

const mockEvents = {
  containerRecoveryNeeded: 0,
  reconnectSSE: vi.fn(),
  disconnectSSE: vi.fn(),
  closeSSE: vi.fn(),
  startResume: vi.fn(),
  clearResume: vi.fn(),
  notifyContainerChanged: vi.fn(),
}
vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => mockEvents,
}))

const mockContainerMap = { setSessionContainer: vi.fn() }
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

// Mock API modules
const mockSetContainerId = vi.fn()
vi.mock('../../../api/apiClient', () => ({
  setContainerId: (...args) => mockSetContainerId(...args),
}))

const mockResumeSession = vi.fn()
vi.mock('../../../api/sessions', () => ({
  resumeSession: (...args) => mockResumeSession(...args),
}))

describe('ContainerRecoveryEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouting.activeSessionId = 'sess-1'
    mockEvents.containerRecoveryNeeded = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Render the effect, then re-render with incremented containerRecoveryNeeded. */
  function renderAndExhaust(overrides = {}) {
    Object.assign(mockRouting, overrides.routing || {})
    Object.assign(mockEvents, overrides.events || {})

    const { rerender } = render(<ContainerRecoveryEffect />)

    // Simulate SSE reconnect exhaustion
    mockEvents.containerRecoveryNeeded = (overrides.events?.containerRecoveryNeeded || 0) + 1
    rerender(<ContainerRecoveryEffect />)

    return { rerender }
  }

  it('does nothing on initial render', () => {
    render(<ContainerRecoveryEffect />)

    expect(mockResumeSession).not.toHaveBeenCalled()
    expect(mockEvents.startResume).not.toHaveBeenCalled()
  })

  it('resumes session with fresh container ID when SSE reconnect exhausts', async () => {
    mockResumeSession.mockResolvedValue({ container_id: 'fresh-ctr' })

    renderAndExhaust()

    await vi.waitFor(() => {
      expect(mockResumeSession).toHaveBeenCalledWith('sess-1')
    })

    expect(mockEvents.startResume).toHaveBeenCalled()
    expect(mockSetContainerId).toHaveBeenCalledWith('fresh-ctr')
    expect(mockEvents.notifyContainerChanged).toHaveBeenCalled()
    expect(mockContainerMap.setSessionContainer).toHaveBeenCalledWith('sess-1', 'fresh-ctr')
    expect(mockSessionActions.clearSessionData).toHaveBeenCalled()
    expect(mockEvents.reconnectSSE).toHaveBeenCalled()
  })

  it('disconnects SSE and shows error on resume failure', async () => {
    mockResumeSession.mockRejectedValue(new Error('network error'))

    renderAndExhaust()

    await vi.waitFor(() => {
      expect(mockInteraction.setError).toHaveBeenCalledWith(
        'Container reconnect failed — waiting for daemon',
      )
    })

    expect(mockEvents.clearResume).toHaveBeenCalled()
    expect(mockEvents.disconnectSSE).toHaveBeenCalled()
    expect(mockEvents.closeSSE).not.toHaveBeenCalled()
    expect(mockEvents.reconnectSSE).not.toHaveBeenCalled()
  })

  it('closes SSE without resume when no active session', () => {
    renderAndExhaust({
      routing: { activeSessionId: null },
    })

    expect(mockResumeSession).not.toHaveBeenCalled()
    expect(mockEvents.closeSSE).toHaveBeenCalled()
  })

  it('fires only on counter increment, not re-renders', () => {
    const { rerender } = render(<ContainerRecoveryEffect />)

    // Same value re-render
    rerender(<ContainerRecoveryEffect />)
    expect(mockEvents.startResume).not.toHaveBeenCalled()
  })
})
