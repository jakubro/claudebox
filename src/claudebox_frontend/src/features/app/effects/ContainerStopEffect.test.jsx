/** Tests for ContainerStopEffect. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock context hooks
const mockDisconnectSSE = vi.fn()
const mockClearSessionData = vi.fn()
let mockContainerId = 'ctr-1'
let mockIsConnected = true
let mockIsCreating = false
let mockIsResuming = false
let mockSessions = [{ session_id: 's1', container_id: 'ctr-1' }]
let mockContainerMap = {}

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => ({
    containerId: mockContainerId,
    disconnectSSE: mockDisconnectSSE,
    isConnected: mockIsConnected,
    isCreating: mockIsCreating,
    isResuming: mockIsResuming,
  }),
}))

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionActions: () => ({ clearSessionData: mockClearSessionData }),
}))

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions }),
}))

vi.mock('../../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({ containerMap: mockContainerMap }),
}))

// Import after mocks
import ContainerStopEffect from './ContainerStopEffect'

describe('ContainerStopEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContainerId = 'ctr-1'
    mockIsConnected = true
    mockIsCreating = false
    mockIsResuming = false
    mockSessions = [{ session_id: 's1', container_id: 'ctr-1' }]
    mockContainerMap = {}
  })

  /** Render the effect as a hook wrapper (it returns null). */
  function renderEffect() {
    return renderHook(() => {}, {
      wrapper: ({ children }) => (
        <>
          <ContainerStopEffect />
          {children}
        </>
      ),
    })
  }

  it('does not disconnect on initial mount', () => {
    renderEffect()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
    expect(mockClearSessionData).not.toHaveBeenCalled()
  })

  it('disconnects when active container disappears from sessions list', () => {
    const { rerender } = renderEffect()

    // Simulate container gone from sessions list (after daemon refetch)
    mockSessions = [{ session_id: 's2', container_id: 'ctr-2' }]

    rerender()

    expect(mockDisconnectSSE).toHaveBeenCalledOnce()
    expect(mockClearSessionData).toHaveBeenCalledOnce()
  })

  it('does not disconnect when active container still in sessions list', () => {
    const { rerender } = renderEffect()

    // Sessions refreshed but container still present
    mockSessions = [
      { session_id: 's1', container_id: 'ctr-1' },
      { session_id: 's2', container_id: 'ctr-2' },
    ]

    rerender()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })

  it('does not disconnect when no active container', () => {
    mockContainerId = null
    const { rerender } = renderEffect()

    mockSessions = []

    rerender()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })

  it('does not disconnect when already disconnected', () => {
    mockIsConnected = false
    const { rerender } = renderEffect()

    mockSessions = []

    rerender()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })

  it('does not disconnect when sessions list is empty (not yet loaded)', () => {
    mockSessions = []
    renderEffect()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })

  it('does not disconnect when isCreating is true even if container is gone', () => {
    mockIsCreating = true
    mockSessions = [{ session_id: 's2', container_id: 'ctr-2' }]

    renderEffect()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })

  it('does not disconnect when isResuming is true even if container is gone', () => {
    mockIsResuming = true
    mockSessions = [{ session_id: 's2', container_id: 'ctr-2' }]

    renderEffect()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })

  it('disconnects when isCreating clears and container is gone from both sources', () => {
    mockIsCreating = true
    mockSessions = [{ session_id: 's2', container_id: 'ctr-2' }]
    mockContainerMap = {}

    const { rerender } = renderEffect()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()

    // Creating completes but container never appeared in sessions list or containerMap
    mockIsCreating = false

    rerender()

    expect(mockDisconnectSSE).toHaveBeenCalledOnce()
    expect(mockClearSessionData).toHaveBeenCalledOnce()
  })

  it('does not disconnect when container absent from sessions but present in containerMap', () => {
    // Simulates the race: sessions list stale, but containerMap populated eagerly
    mockSessions = [{ session_id: 's2', container_id: 'ctr-2' }]
    mockContainerMap = { s1: 'ctr-1' }

    renderEffect()

    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })
})
