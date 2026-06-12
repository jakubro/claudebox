/** Tests for SessionRoutingEffect - board route triggers workspace switch when URL workspace differs. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Routing
let mockActiveSessionId = null
let mockActiveBoardId = null
let mockActiveWorkspaceId = null
const mockNavigateHome = vi.fn()

// Workspace
let mockWorkspaceId = null
const mockSelectWorkspace = vi.fn()

// Other contexts (no-op for board path)
const mockReconnectSSE = vi.fn()
const mockDisconnectSSE = vi.fn()
const mockStartResume = vi.fn()
const mockClearResume = vi.fn()
const mockNotifyContainerChanged = vi.fn()
const mockSetSessionContainer = vi.fn()
const mockClearProgress = vi.fn()
const mockClearSessionData = vi.fn()
const mockClearStash = vi.fn()
const mockSetError = vi.fn()

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    activeSessionId: mockActiveSessionId,
    activeBoardId: mockActiveBoardId,
    activeWorkspaceId: mockActiveWorkspaceId,
    navigateHome: mockNavigateHome,
  }),
}))

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: mockWorkspaceId, selectWorkspace: mockSelectWorkspace }),
}))

vi.mock('../../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({ setSessionContainer: mockSetSessionContainer }),
}))

vi.mock('../../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => ({ clearProgress: mockClearProgress }),
}))

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => ({
    reconnectSSE: mockReconnectSSE,
    disconnectSSE: mockDisconnectSSE,
    startResume: mockStartResume,
    clearResume: mockClearResume,
    notifyContainerChanged: mockNotifyContainerChanged,
    isCreating: false,
  }),
}))

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionActions: () => ({ clearSessionData: mockClearSessionData }),
}))

vi.mock('../../../context/StashContext', () => ({
  useStash: () => ({ clearStash: mockClearStash }),
}))

vi.mock('../../../context/InteractionContext', () => ({
  useInteraction: () => ({ setError: mockSetError }),
}))

vi.mock('../../../api/apiClient', () => ({ setContainerId: vi.fn() }))
vi.mock('../../../api/sessions', () => ({ resumeSession: vi.fn() }))

import SessionRoutingEffect from './SessionRoutingEffect'

describe('SessionRoutingEffect - board route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessionId = null
    mockActiveBoardId = null
    mockActiveWorkspaceId = null
    mockWorkspaceId = null
  })

  function render() {
    return renderHook(() => {}, {
      wrapper: ({ children }) => (
        <>
          <SessionRoutingEffect onUpdateChatTitle={vi.fn()} />
          {children}
        </>
      ),
    })
  }

  it('does not switch workspace when the board URL matches the active workspace', () => {
    mockActiveBoardId = 'b1'
    mockActiveWorkspaceId = 'ws-A'
    mockWorkspaceId = 'ws-A'

    render()

    expect(mockSelectWorkspace).not.toHaveBeenCalled()
  })

  it('switches workspace when the board URL targets a different workspace', () => {
    mockActiveBoardId = 'b1'
    mockActiveWorkspaceId = 'ws-B'
    mockWorkspaceId = 'ws-A'

    render()

    expect(mockSelectWorkspace).toHaveBeenCalledWith('ws-B')
  })

  it('waits for workspace discovery to settle when workspaceId is still null', () => {
    mockActiveBoardId = 'b1'
    mockActiveWorkspaceId = 'ws-A'
    mockWorkspaceId = null

    render()

    // Discovery in flight - workspace switch deferred. WorkspaceContext
    // discovery will auto-select the URL's workspace when it matches.
    expect(mockSelectWorkspace).not.toHaveBeenCalled()
  })

  it('does not switch workspace if no board id is active', () => {
    mockActiveBoardId = null
    mockActiveWorkspaceId = 'ws-B'
    mockWorkspaceId = 'ws-A'

    render()

    expect(mockSelectWorkspace).not.toHaveBeenCalled()
  })
})
