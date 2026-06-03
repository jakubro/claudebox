/** Tests for useNewSession hook. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFocusChatTab = vi.fn()
const mockSetError = vi.fn()
const mockNewSession = vi.fn()
const mockNotifyContainerChanged = vi.fn()
const mockReconnectSSE = vi.fn()
const mockStartCreating = vi.fn()
const mockClearCreating = vi.fn()
const mockSetContainerId = vi.fn()
const mockNavigateToSession = vi.fn()

vi.mock('../api/apiClient', () => ({
  setContainerId: (...args) => mockSetContainerId(...args),
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
    notifyContainerChanged: mockNotifyContainerChanged,
    reconnectSSE: mockReconnectSSE,
    startCreating: mockStartCreating,
    clearCreating: mockClearCreating,
    isCreating: false,
    isResponding: false,
  }),
}))

vi.mock('../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
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

vi.mock('../context/SessionDataContext', () => ({
  useSessionData: () => ({
    sessionId: null,
    sessionName: null,
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    workspace: '/home/user/project',
  }),
  useSessionActions: () => ({
    clearSessionData: mockClearSessionData,
    seedSessionData: mockSeedSessionData,
    mergeSessionData: mockMergeSessionData,
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
  })

  it('seeds session data, sets container, and navigates on success', async () => {
    mockNewSession.mockResolvedValue({ session_id: 's1', name: 'Alpha', container_id: 'c1' })

    const { result } = renderHook(() => useNewSession())

    const ok = await result.current.executeNewSession()

    expect(ok).toBe(true)
    expect(mockStartCreating).toHaveBeenCalledTimes(1)
    // clearCreating NOT called on success — ChatPanel effect clears when SSE connects
    expect(mockClearCreating).not.toHaveBeenCalled()
    // Pre-call clears stale data; post-call seeds with the full SessionInfo response.
    expect(mockClearSessionData).toHaveBeenCalledTimes(1)
    expect(mockSeedSessionData).toHaveBeenCalledWith({
      session_id: 's1',
      name: 'Alpha',
      container_id: 'c1',
    })
    expect(mockMergeSessionData).not.toHaveBeenCalled()
    expect(mockNewSession).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(mockSetContainerId).toHaveBeenCalledWith('c1')
    expect(mockNotifyContainerChanged).toHaveBeenCalledTimes(1)
    expect(mockReconnectSSE).toHaveBeenCalledTimes(1)
    expect(mockSetSessionContainer).toHaveBeenCalledWith('s1', 'c1')
    expect(mockNavigateToSession).toHaveBeenCalledWith('my-workspace', 's1')
    // focusChatTab fires twice — once before the API call, once after success.
    expect(mockFocusChatTab).toHaveBeenCalledTimes(2)
  })

  it('skips container wiring when session_id is missing', async () => {
    mockNewSession.mockResolvedValue({})

    const { result } = renderHook(() => useNewSession())

    const ok = await result.current.executeNewSession()

    expect(ok).toBe(true)
    expect(mockStartCreating).toHaveBeenCalledTimes(1)
    expect(mockClearCreating).not.toHaveBeenCalled()
    expect(mockSetContainerId).not.toHaveBeenCalled()
    expect(mockNotifyContainerChanged).not.toHaveBeenCalled()
    expect(mockReconnectSSE).not.toHaveBeenCalled()
    expect(mockNavigateToSession).not.toHaveBeenCalled()
    expect(mockFocusChatTab).toHaveBeenCalledTimes(2)
  })

  it('clears creating and surfaces an error on failure', async () => {
    mockNewSession.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useNewSession())

    const ok = await result.current.executeNewSession()

    expect(ok).toBe(false)
    expect(mockStartCreating).toHaveBeenCalledTimes(1)
    expect(mockClearCreating).toHaveBeenCalledTimes(1)
    expect(mockSetError).toHaveBeenCalledWith('New session failed')
    expect(mockReconnectSSE).not.toHaveBeenCalled()
    expect(mockNavigateToSession).not.toHaveBeenCalled()
    // focusChatTab called once at start, not again after error
    expect(mockFocusChatTab).toHaveBeenCalledTimes(1)
  })

  it('returns a stable executeNewSession across renders', () => {
    const { result, rerender } = renderHook(() => useNewSession())

    const first = result.current.executeNewSession
    rerender()
    expect(result.current.executeNewSession).toBe(first)
  })

  describe('executeNewSessionInNewTab', () => {
    it('does not toggle global isCreating on the originating tab', async () => {
      // Originating tab must remain a passive bystander — the new browser
      // tab manages its own EventsContext flags when it loads. Toggling
      // startCreating here would render the chat overlay on the
      // originating tab while the new tab opens.
      mockNewSession.mockResolvedValue({ session_id: 's2', container_id: 'c2' })

      const { result } = renderHook(() => useNewSession())

      await result.current.executeNewSessionInNewTab()

      expect(mockStartCreating).not.toHaveBeenCalled()
      expect(mockClearCreating).not.toHaveBeenCalled()
    })

    it('drives the local in-tab spinner via isCreatingInNewTab', async () => {
      mockNewSession.mockResolvedValue({ session_id: 's3', container_id: 'c3' })

      const { result } = renderHook(() => useNewSession())

      const promise = result.current.executeNewSessionInNewTab()
      // The spinner state lives in local React state; resolution turns it back off.
      await promise
      // After completion, the local flag is reset.
      expect(result.current.isCreatingInNewTab).toBe(false)
    })
  })
})
