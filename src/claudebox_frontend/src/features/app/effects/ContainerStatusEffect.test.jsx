/** Tests for ContainerStatusEffect component. */

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDaemonCtx = { lastContainerEvent: null }
vi.mock('../../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => mockDaemonCtx,
}))

const mockContainerMap = {
  containerMap: {},
  addStoppingSession: vi.fn(),
  removeStoppingSession: vi.fn(),
  removeSessionContainer: vi.fn(),
}
vi.mock('../../../context/ContainerMapContext', () => ({
  useContainerMap: () => mockContainerMap,
}))

const mockSessionsList = { sessions: [] }
vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => mockSessionsList,
}))

import ContainerStatusEffect from './ContainerStatusEffect'

describe('ContainerStatusEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDaemonCtx.lastContainerEvent = null
    mockContainerMap.containerMap = {}
    mockSessionsList.sessions = []
  })

  it('renders nothing', () => {
    const { container } = render(<ContainerStatusEffect />)
    expect(container.innerHTML).toBe('')
  })

  it('does nothing when no container event', () => {
    render(<ContainerStatusEffect />)
    expect(mockContainerMap.addStoppingSession).not.toHaveBeenCalled()
  })

  it('marks session as stopping on stopping event via containerMap', () => {
    mockContainerMap.containerMap = { 'session-1': 'ctr-1' }
    mockDaemonCtx.lastContainerEvent = { containerId: 'ctr-1', status: 'stopping' }

    render(<ContainerStatusEffect />)

    expect(mockContainerMap.addStoppingSession).toHaveBeenCalledWith('session-1')
  })

  it('marks session as stopping on stopping event via sessions list', () => {
    mockSessionsList.sessions = [{ session_id: 'session-2', container_id: 'ctr-2' }]
    mockDaemonCtx.lastContainerEvent = { containerId: 'ctr-2', status: 'stopping' }

    render(<ContainerStatusEffect />)

    expect(mockContainerMap.addStoppingSession).toHaveBeenCalledWith('session-2')
  })

  it('does not mark session when containerId not found on stopping', () => {
    mockDaemonCtx.lastContainerEvent = { containerId: 'unknown', status: 'stopping' }

    render(<ContainerStatusEffect />)

    expect(mockContainerMap.addStoppingSession).not.toHaveBeenCalled()
  })

  it('removes stopping session on stopped event', () => {
    // First render with stopping to cache the mapping
    mockContainerMap.containerMap = { 'session-1': 'ctr-1' }
    mockDaemonCtx.lastContainerEvent = { containerId: 'ctr-1', status: 'stopping' }
    const { rerender } = render(<ContainerStatusEffect />)

    // Now simulate stopped event
    mockDaemonCtx.lastContainerEvent = { containerId: 'ctr-1', status: 'stopped' }
    rerender(<ContainerStatusEffect />)

    expect(mockContainerMap.removeStoppingSession).toHaveBeenCalledWith('session-1')
    expect(mockContainerMap.removeSessionContainer).toHaveBeenCalledWith('session-1')
  })

  it('resolves stopped event from containerMap when not cached', () => {
    mockContainerMap.containerMap = { 'session-3': 'ctr-3' }
    mockDaemonCtx.lastContainerEvent = { containerId: 'ctr-3', status: 'stopped' }

    render(<ContainerStatusEffect />)

    expect(mockContainerMap.removeStoppingSession).toHaveBeenCalledWith('session-3')
    expect(mockContainerMap.removeSessionContainer).toHaveBeenCalledWith('session-3')
  })

  it('resolves stopped event from sessions list when not in containerMap', () => {
    mockSessionsList.sessions = [{ session_id: 'session-4', container_id: 'ctr-4' }]
    mockDaemonCtx.lastContainerEvent = { containerId: 'ctr-4', status: 'stopped' }

    render(<ContainerStatusEffect />)

    expect(mockContainerMap.removeStoppingSession).toHaveBeenCalledWith('session-4')
  })

  it('does nothing on stopped event when containerId not found', () => {
    mockDaemonCtx.lastContainerEvent = { containerId: 'unknown', status: 'stopped' }

    render(<ContainerStatusEffect />)

    expect(mockContainerMap.removeStoppingSession).not.toHaveBeenCalled()
  })
})
