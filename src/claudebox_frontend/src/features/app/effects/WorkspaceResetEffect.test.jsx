/** Tests for WorkspaceResetEffect - a workspace switch releases the session left. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockWorkspaceId = null
let mockRouteWorkspaceId = null
const mockCloseSSE = vi.fn()
const mockReconnectSSE = vi.fn()
const mockClearSessionData = vi.fn()
const mockClearStash = vi.fn()
const mockNavigateToWorkspace = vi.fn()

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: mockWorkspaceId }),
}))
vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => ({ closeSSE: mockCloseSSE, reconnectSSE: mockReconnectSSE }),
}))
vi.mock('../../../context/SessionDataContext', () => ({
  useSessionActions: () => ({ clearSessionData: mockClearSessionData }),
}))
vi.mock('../../../context/StashContext', () => ({
  useStash: () => ({ clearStash: mockClearStash }),
}))
vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    navigateToWorkspace: mockNavigateToWorkspace,
    activeWorkspaceId: mockRouteWorkspaceId,
  }),
}))

import WorkspaceResetEffect from './WorkspaceResetEffect'

function render() {
  return renderHook(() => {}, {
    wrapper: ({ children }) => (
      <>
        <WorkspaceResetEffect />
        {children}
      </>
    ),
  })
}

describe('WorkspaceResetEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceId = null
    mockRouteWorkspaceId = null
  })

  it('does nothing on the first selection', () => {
    const { rerender } = render()

    mockWorkspaceId = 'W1'
    rerender()

    expect(mockCloseSSE).not.toHaveBeenCalled()
    expect(mockReconnectSSE).not.toHaveBeenCalled()
  })

  it('releases the session left on a switch instead of reopening its stream', () => {
    mockWorkspaceId = 'W1'
    const { rerender } = render()

    mockWorkspaceId = 'W2'
    rerender()

    expect(mockCloseSSE).toHaveBeenCalledTimes(1)
    expect(mockReconnectSSE).not.toHaveBeenCalled()
    expect(mockClearSessionData).toHaveBeenCalledTimes(1)
    expect(mockClearStash).toHaveBeenCalledTimes(1)
  })

  it('keeps the address when a link in it caused the switch', () => {
    mockWorkspaceId = 'W2'
    mockRouteWorkspaceId = 'W2'
    const { rerender } = render()

    mockRouteWorkspaceId = 'W1'
    mockWorkspaceId = 'W1'
    rerender()

    expect(mockNavigateToWorkspace).not.toHaveBeenCalled()
    expect(mockClearSessionData).toHaveBeenCalledTimes(1)
    expect(mockCloseSSE).toHaveBeenCalledTimes(1)
  })

  it('lands on the new workspace home when the switcher caused the switch', () => {
    mockWorkspaceId = 'W2'
    mockRouteWorkspaceId = 'W2'
    const { rerender } = render()

    mockWorkspaceId = 'W1'
    rerender()

    expect(mockNavigateToWorkspace).toHaveBeenCalledWith('W1')
  })
})
