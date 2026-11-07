/** Tests for useNewSession hook. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFocusChatTab = vi.fn()
const mockSetError = vi.fn()
const mockNewSession = vi.fn()
const mockNotifyAddressChanged = vi.fn()
const mockReconnectSSE = vi.fn()
const mockStartCreating = vi.fn(() => 4)
const mockSettleCreateRequest = vi.fn()
const mockFailCreating = vi.fn()
const mockMarkJustCreatedSession = vi.fn()
const mockSetAddress = vi.fn()
const mockNavigateToSession = vi.fn()

vi.mock('../api/apiClient', () => ({
  setAddress: (...args) => mockSetAddress(...args),
}))

vi.mock('../api/sessions', () => ({
  newSession: (...args) => mockNewSession(...args),
}))

vi.mock('../context/AppActionsContext', () => ({
  useAppActions: () => ({
    focusChatTab: mockFocusChatTab,
  }),
}))

vi.mock('../context/InteractionContext', () => ({
  useInteraction: () => ({
    setError: mockSetError,
  }),
}))

vi.mock('../context/EventsContext', () => ({
  useEvents: () => ({
    notifyAddressChanged: mockNotifyAddressChanged,
    reconnectSSE: mockReconnectSSE,
    startCreating: mockStartCreating,
    settleCreateRequest: mockSettleCreateRequest,
    failCreating: mockFailCreating,
    markJustCreatedSession: mockMarkJustCreatedSession,
    isCreating: false,
    isResponding: false,
  }),
}))

vi.mock('../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    activeSessionId: 'sess-a',
    navigateToSession: mockNavigateToSession,
  }),
}))

const mockShowStillRunningToast = vi.fn()
const mockDismissStillRunningToast = vi.fn()
const mockStillRunningToastValue = {
  toast: null,
  showStillRunningToast: mockShowStillRunningToast,
  dismissStillRunningToast: mockDismissStillRunningToast,
}

vi.mock('../context/StillRunningToastContext', () => ({
  useStillRunningToast: () => mockStillRunningToastValue,
}))

const mockSetSessionContainer = vi.fn()

const mockClearSessionData = vi.fn()
const mockSeedSessionData = vi.fn()
const mockMergeSessionData = vi.fn()

let mockDeferredBundle = null
let mockSessionData = null
const mockRefreshSession = vi.fn()

vi.mock('../context/SessionDataContext', () => ({
  useSessionData: () => ({
    deferredBundle: mockDeferredBundle,
    sessionData: mockSessionData,
    sessionId: null,
    sessionName: null,
    model: 'claude-sonnet-5',
    permissionMode: 'bypassPermissions',
    workspace: '/home/user/project',
  }),
  useSessionActions: () => ({
    clearSessionData: mockClearSessionData,
    seedSessionData: mockSeedSessionData,
    mergeSessionData: mockMergeSessionData,
    refreshSession: mockRefreshSession,
  }),
}))

vi.mock('../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    containerMap: {},
    setSessionContainer: mockSetSessionContainer,
    removeSessionContainer: vi.fn(),
  }),
}))

const mockClearProgress = vi.fn()

vi.mock('../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => ({
    clearProgress: mockClearProgress,
  }),
}))

vi.mock('../context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    workspaceId: 'my-workspace',
  }),
}))

import useNewSession from './useNewSession'

describe('useNewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeferredBundle = null
    mockSessionData = null
  })

  it.each([
    ['the bundle picked on the welcome screen', 'research', undefined, 'research'],
    ['a bundle named by the caller over the pick', 'research', 'review', 'review'],
    ['no bundle with nothing picked', null, undefined, undefined],
  ])('creates under %s', async (_label, picked, named, expected) => {
    mockDeferredBundle = picked
    mockNewSession.mockResolvedValue({})
    const { result } = renderHook(() => useNewSession())

    await result.current.executeNewSession(named)

    expect(mockNewSession.mock.calls[0][0].bundle).toBe(expected)
  })

  it('seeds session data, sets container, and navigates on success', async () => {
    mockNewSession.mockResolvedValue({ session_id: 's1', name: 'Alpha', container_id: 'c1' })

    const { result } = renderHook(() => useNewSession())

    const ok = await result.current.executeNewSession()

    expect(ok).toBe(true)
    expect(mockStartCreating).toHaveBeenCalledWith('sess-a', [])
    expect(mockSettleCreateRequest).toHaveBeenCalledWith(4, 's1', {
      undeliveredMessages: [],
      bundleMessages: [],
    })
    expect(mockSettleCreateRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mockReconnectSSE.mock.invocationCallOrder[0],
    )
    expect(mockFailCreating).not.toHaveBeenCalled()
    // Pre-call clears stale data; post-call seeds with the full SessionInfo response.
    expect(mockClearSessionData).toHaveBeenCalledTimes(1)
    expect(mockSeedSessionData).toHaveBeenCalledWith({
      session_id: 's1',
      name: 'Alpha',
      container_id: 'c1',
    })
    expect(mockMergeSessionData).not.toHaveBeenCalled()
    expect(mockNewSession).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(mockSetAddress).toHaveBeenCalledWith('c1', 's1')
    expect(mockNotifyAddressChanged).toHaveBeenCalledTimes(1)
    expect(mockReconnectSSE).toHaveBeenCalledTimes(1)
    expect(mockSetSessionContainer).toHaveBeenCalledWith('s1', 'c1')
    expect(mockNavigateToSession).toHaveBeenCalledWith('my-workspace', 's1')
    // focusChatTab fires twice - once before the API call, once after success.
    expect(mockFocusChatTab).toHaveBeenCalledTimes(2)
    // Must be marked before navigating - the routing effect needs it in place to skip the resume.
    expect(mockMarkJustCreatedSession).toHaveBeenCalledWith('s1')
    expect(mockMarkJustCreatedSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigateToSession.mock.invocationCallOrder[0],
    )
  })

  it('skips container wiring when session_id is missing', async () => {
    mockNewSession.mockResolvedValue({})

    const { result } = renderHook(() => useNewSession())

    const ok = await result.current.executeNewSession()

    expect(ok).toBe(true)
    expect(mockStartCreating).toHaveBeenCalledTimes(1)
    expect(mockSettleCreateRequest).toHaveBeenCalledWith(4, null, {
      undeliveredMessages: [],
      bundleMessages: [],
    })
    expect(mockSetAddress).not.toHaveBeenCalled()
    expect(mockNotifyAddressChanged).not.toHaveBeenCalled()
    expect(mockReconnectSSE).not.toHaveBeenCalled()
    expect(mockNavigateToSession).not.toHaveBeenCalled()
    expect(mockFocusChatTab).toHaveBeenCalledTimes(2)
  })

  it('fails its creation and surfaces an error on failure', async () => {
    mockNewSession.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useNewSession())

    const ok = await result.current.executeNewSession()

    expect(ok).toBe(false)
    expect(mockStartCreating).toHaveBeenCalledTimes(1)
    expect(mockFailCreating).toHaveBeenCalledWith(4)
    expect(mockSettleCreateRequest).not.toHaveBeenCalled()
    expect(mockSetError).toHaveBeenCalledWith('New session failed')
    expect(mockReconnectSSE).not.toHaveBeenCalled()
    expect(mockNavigateToSession).not.toHaveBeenCalled()
    // focusChatTab called once at start, not again after error
    expect(mockFocusChatTab).toHaveBeenCalledTimes(1)
  })

  it('puts the session left back on screen when the creation fails', async () => {
    mockSessionData = { session_id: 'A', name: 'Alpha', model: 'claude-opus-5' }
    mockNewSession.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useNewSession())

    await result.current.executeNewSession()

    expect(mockClearSessionData).toHaveBeenCalledTimes(1)
    expect(mockSeedSessionData).toHaveBeenCalledWith({
      session_id: 'A',
      name: 'Alpha',
      model: 'claude-opus-5',
    })
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
  })

  it('fails its creation, without an error, when the request is aborted', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    mockNewSession.mockRejectedValue(abort)

    const { result } = renderHook(() => useNewSession())

    const ok = await result.current.executeNewSession()

    expect(ok).toBe(false)
    expect(mockFailCreating).toHaveBeenCalledWith(4)
    expect(mockSetError).not.toHaveBeenCalled()
  })

  it('fails the creation it cancels', async () => {
    mockNewSession.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useNewSession())

    void result.current.executeNewSession()
    result.current.cancelCreation()

    expect(mockFailCreating).toHaveBeenCalledWith(4)
  })

  it('returns a stable executeNewSession across renders', () => {
    const { result, rerender } = renderHook(() => useNewSession())

    const first = result.current.executeNewSession
    rerender()
    expect(result.current.executeNewSession).toBe(first)
  })

  describe('executeNewSessionFromLink', () => {
    it('threads messages to newSession and reports what was undelivered', async () => {
      mockNewSession.mockResolvedValue({
        session_id: 's4',
        container_id: 'c4',
        undelivered_messages: ['/danger'],
      })

      const { result } = renderHook(() => useNewSession())

      const { success, undeliveredMessages } = await result.current.executeNewSessionFromLink([
        '/greet ada',
        '/danger',
      ])

      expect(mockNewSession).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
        messages: ['/greet ada', '/danger'],
      })
      expect(success).toBe(true)
      expect(undeliveredMessages).toEqual(['/danger'])
    })

    it('hands the carried messages to the creation, and the answer about them and the bundle after', async () => {
      mockNewSession.mockResolvedValue({
        session_id: 's6',
        container_id: 'c6',
        undelivered_messages: ['/danger'],
        bundle_messages: ['open the plan'],
      })

      const { result } = renderHook(() => useNewSession())
      await result.current.executeNewSessionFromLink(['/danger'])

      expect(mockStartCreating).toHaveBeenCalledWith('sess-a', ['/danger'])
      expect(mockSettleCreateRequest).toHaveBeenCalledWith(4, 's6', {
        undeliveredMessages: ['/danger'],
        bundleMessages: ['open the plan'],
      })
    })

    it('defaults undeliveredMessages to empty when the response omits it', async () => {
      mockNewSession.mockResolvedValue({ session_id: 's5', container_id: 'c5' })

      const { result } = renderHook(() => useNewSession())

      const { undeliveredMessages } = await result.current.executeNewSessionFromLink(['/greet ada'])

      expect(undeliveredMessages).toEqual([])
    })
  })

  describe('executeNewSessionInNewTab', () => {
    it('does not toggle global isCreating on the originating tab', async () => {
      // Originating tab must stay passive - toggling startCreating here would show the chat overlay on this tab.
      mockNewSession.mockResolvedValue({ session_id: 's2', container_id: 'c2' })

      const { result } = renderHook(() => useNewSession())

      await result.current.executeNewSessionInNewTab()

      expect(mockStartCreating).not.toHaveBeenCalled()
      expect(mockFailCreating).not.toHaveBeenCalled()
    })

    it('drives the local in-tab spinner via isCreatingInNewTab', async () => {
      mockNewSession.mockResolvedValue({ session_id: 's3', container_id: 'c3' })

      const { result } = renderHook(() => useNewSession())

      const promise = result.current.executeNewSessionInNewTab()
      // The spinner state lives in local React state; resolution turns it back off.
      await promise
      expect(result.current.isCreatingInNewTab).toBe(false)
    })
  })
})
