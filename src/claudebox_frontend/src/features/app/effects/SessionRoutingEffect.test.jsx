/** Tests for SessionRoutingEffect - board route triggers workspace switch when URL workspace differs. */

import { renderHook, waitFor } from '@testing-library/react'
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
const mockCloseSSE = vi.fn()
const mockStartResume = vi.fn()
const mockSettleResumeRequest = vi.fn()
const mockClearResume = vi.fn()
const mockNotifyAddressChanged = vi.fn()
const mockSetSessionContainer = vi.fn()
const mockClearProgress = vi.fn()
const mockClearSessionData = vi.fn()
const mockClearStash = vi.fn()
const mockSetError = vi.fn()
const mockConsumeJustCreatedSession = vi.fn(() => false)

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
    closeSSE: mockCloseSSE,
    startResume: mockStartResume,
    settleResumeRequest: mockSettleResumeRequest,
    clearResume: mockClearResume,
    notifyAddressChanged: mockNotifyAddressChanged,
    consumeJustCreatedSession: mockConsumeJustCreatedSession,
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

vi.mock('../../../api/apiClient', () => ({ setAddress: vi.fn() }))
vi.mock('../../../api/sessions', () => ({ resumeSession: vi.fn() }))

import { resumeSession } from '../../../api/sessions'
import SessionRoutingEffect from './SessionRoutingEffect'

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

describe('SessionRoutingEffect - board route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessionId = null
    mockActiveBoardId = null
    mockActiveWorkspaceId = null
    mockWorkspaceId = null
    mockConsumeJustCreatedSession.mockReturnValue(false)
  })

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

    // Discovery in flight; WorkspaceContext auto-selects the URL's workspace once it resolves.
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

describe('SessionRoutingEffect - session resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessionId = null
    mockActiveBoardId = null
    mockActiveWorkspaceId = null
    mockWorkspaceId = null
    mockConsumeJustCreatedSession.mockReturnValue(false)
    resumeSession.mockResolvedValue({ container_id: 'c1' })
  })

  it('resumes a session reached by normal navigation', async () => {
    mockActiveSessionId = 's1'

    render()

    await waitFor(() => {
      expect(resumeSession).toHaveBeenCalledWith('s1')
    })
  })

  it('skips resume for a session this tab just created, even if isCreating already cleared', async () => {
    mockActiveSessionId = 's1'
    mockConsumeJustCreatedSession.mockReturnValue(true)

    render()

    await waitFor(() => {
      expect(mockConsumeJustCreatedSession).toHaveBeenCalledWith('s1')
    })
    expect(resumeSession).not.toHaveBeenCalled()
  })
})

describe('SessionRoutingEffect - open request lifetime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessionId = null
    mockActiveBoardId = null
    mockActiveWorkspaceId = null
    mockWorkspaceId = null
    mockConsumeJustCreatedSession.mockReturnValue(false)
    mockStartResume.mockReturnValueOnce(7).mockReturnValueOnce(8)
  })

  it('settles the open request immediately before reconnecting', async () => {
    const order = []
    mockSettleResumeRequest.mockImplementation(token => order.push(`settle:${token}`))
    mockReconnectSSE.mockImplementation(() => order.push('reconnect'))
    resumeSession.mockResolvedValue({ container_id: 'c1' })
    mockActiveSessionId = 's1'

    render()

    await waitFor(() => {
      expect(order).toEqual(['settle:7', 'reconnect'])
    })
  })

  it('settles nothing for a response that arrives after the route moved on', async () => {
    let resolveFirst
    resumeSession.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve
        }),
    )
    resumeSession.mockImplementationOnce(() => new Promise(() => {}))
    mockActiveSessionId = 's1'
    const { rerender } = render()
    mockActiveSessionId = 's2'
    rerender()

    resolveFirst({ container_id: 'c1' })
    await waitFor(() => {
      expect(resumeSession).toHaveBeenCalledWith('s2')
    })

    expect(mockSettleResumeRequest).not.toHaveBeenCalled()
    expect(mockReconnectSSE).not.toHaveBeenCalled()
  })

  it('aborts a pending open when the route goes home', () => {
    resumeSession.mockImplementation(() => new Promise(() => {}))
    mockActiveSessionId = 's1'
    const { rerender } = render()
    mockClearResume.mockClear()

    mockActiveSessionId = null
    rerender()

    expect(mockClearResume).toHaveBeenCalledTimes(1)
  })

  it('aborts a pending open when the route lands on a session this tab just created', () => {
    mockActiveSessionId = 's-new'
    mockConsumeJustCreatedSession.mockReturnValue(true)

    render()

    expect(mockClearResume).toHaveBeenCalledTimes(1)
  })
})

describe('SessionRoutingEffect - leaving every session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessionId = null
    mockActiveBoardId = null
    mockActiveWorkspaceId = null
    mockWorkspaceId = null
    mockConsumeJustCreatedSession.mockReturnValue(false)
    resumeSession.mockResolvedValue({ container_id: 'c1' })
  })

  it('releases the session left, not merely its stream, when no session is routed', async () => {
    mockActiveSessionId = 's1'
    const { rerender } = render()
    await waitFor(() => {
      expect(resumeSession).toHaveBeenCalledWith('s1')
    })

    mockActiveSessionId = null
    rerender()

    expect(mockCloseSSE).toHaveBeenCalledTimes(1)
    expect(mockDisconnectSSE).not.toHaveBeenCalled()
  })
})
