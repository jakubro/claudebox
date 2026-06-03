/** Tests for SessionDataContext (read-only data). */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionDataProvider, useSessionActions, useSessionData } from './SessionDataContext'

// Mock API modules
const mockGetSession = vi.fn()
const mockResumeSession = vi.fn()
const mockGetUiState = vi.fn()
const mockPatchSessionUiState = vi.fn()
const mockSetModel = vi.fn()
const mockSetPermissionMode = vi.fn()
const mockSetEffortLevel = vi.fn()
const mockSetContainerId = vi.fn()
// Default to a present container so picker setters take the API-direct path.
// Tests exercising the welcome-screen buffer override this with `.mockReturnValue(null)`.
const mockGetContainerId = vi.fn(() => 'test-container')

vi.mock('../api/apiClient', () => ({
  setContainerId: (...args) => mockSetContainerId(...args),
  getContainerId: (...args) => mockGetContainerId(...args),
}))

vi.mock('../api/sessions', () => ({
  getSession: (...args) => mockGetSession(...args),
  resumeSession: (...args) => mockResumeSession(...args),
}))

vi.mock('../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchSessionUiState: (...args) => mockPatchSessionUiState(...args),
}))

vi.mock('../api/models', () => ({
  setModel: (...args) => mockSetModel(...args),
}))

vi.mock('../api/permissionModes', () => ({
  setPermissionMode: (...args) => mockSetPermissionMode(...args),
}))

vi.mock('../api/effortLevels', () => ({
  setEffortLevel: (...args) => mockSetEffortLevel(...args),
}))

const mockGetSessionDefaults = vi.fn()
vi.mock('../api/workspaces', () => ({
  getSessionDefaults: (...args) => mockGetSessionDefaults(...args),
}))

vi.mock('./WorkspaceContext', () => ({
  WorkspaceContext: { Consumer: () => null, Provider: () => null, _currentValue: null },
}))

// Mock DaemonStreamContext
vi.mock('./DaemonStreamContext', () => ({
  useDaemonStreamContext: () => ({ sessionsChanged: 0 }),
}))

// Mock EventsContext
const mockReconnectSSE = vi.fn()
const mockNotifyContainerChanged = vi.fn()
const makeEventsData = (overrides = {}) => ({
  isConnected: false,
  isResponding: false,
  reconnectSSE: mockReconnectSSE,
  notifyContainerChanged: mockNotifyContainerChanged,
  ...overrides,
})
let mockEventsData = makeEventsData()
vi.mock('./EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

const SESSION_DATA = {
  session_id: 'sess-1',
  name: 'My Session',
  workspace: '/home/user/projects/myapp',
  session_dir: '/tmp/sessions/sess-1',
  model: 'claude-3',
  num_turns: 5,
  todos: [{ text: 'Fix bug' }],
  total_cost_usd: 0.12,
  total_duration_ms: 3000,
  last_context_tokens: 1024,
  commands: ['/help'],
}

describe('useSessionData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEventsData = makeEventsData()
    mockGetSession.mockResolvedValue(SESSION_DATA)
    mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: false } })
    mockGetSessionDefaults.mockResolvedValue({
      workspace: '/path',
      model: 'claude-3',
      permission_mode: 'default',
      effort_level: 'medium',
      available_models: [{ id: 'claude-3', name: 'Claude 3' }],
      available_permission_modes: [{ id: 'default', name: 'Default' }],
      available_effort_levels: [{ id: 'medium', name: 'Medium' }],
    })
    mockGetContainerId.mockReturnValue('test-container')
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  it('throws when used outside SessionDataProvider', () => {
    expect(() => renderHook(() => useSessionData())).toThrow(
      'useSessionData must be used within SessionDataProvider',
    )
  })

  it('returns empty arrays for available models and permission modes initially', () => {
    const { result } = renderHook(() => useSessionData(), { wrapper })
    expect(result.current.availableModels).toEqual([])
    expect(result.current.availablePermissionModes).toEqual([])
  })

  it('returns null sessionData initially', () => {
    const { result } = renderHook(() => useSessionData(), { wrapper })
    expect(result.current.sessionData).toBeNull()
    expect(result.current.sessionId).toBeNull()
    expect(result.current.sessionName).toBeNull()
  })

  it('fetches session data on connect', async () => {
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(() => useSessionData(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessionId).toBe('sess-1')
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(result.current.sessionName).toBe('My Session')
  })

  it('maps derived values from raw sessionData', async () => {
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(() => useSessionData(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessionId).toBe('sess-1')
    })

    expect(result.current.sessionName).toBe('My Session')
    expect(result.current.sessionDir).toBe('/tmp/sessions/sess-1')
    expect(result.current.model).toBe('claude-3')
    expect(result.current.workspace).toBe('/home/user/projects/myapp')
    expect(result.current.numTurns).toBe(5)
    expect(result.current.todos).toEqual([{ text: 'Fix bug' }])
    expect(result.current.totalCostUsd).toBe(0.12)
    expect(result.current.totalDurationMs).toBe(3000)
    expect(result.current.lastContextTokens).toBe(1024)
    expect(result.current.commands).toEqual(['/help'])
  })

  it('returns defaults for missing sessionData fields', async () => {
    mockGetSession.mockResolvedValue({ session_id: 'partial-session' })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(() => useSessionData(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessionData).toEqual({ session_id: 'partial-session' })
    })

    expect(result.current.sessionId).toBe('partial-session')
    expect(result.current.sessionName).toBeNull()
    expect(result.current.sessionDir).toBeNull()
    expect(result.current.model).toBeNull()
    expect(result.current.workspace).toBeNull()
    expect(result.current.numTurns).toBe(0)
    expect(result.current.todos).toEqual([])
    expect(result.current.totalCostUsd).toBe(0)
    expect(result.current.totalDurationMs).toBe(0)
    expect(result.current.lastContextTokens).toBe(0)
    expect(result.current.commands).toEqual({})
  })

  it('stores workspace before session_id arrives', async () => {
    vi.useFakeTimers()
    mockGetSession
      .mockResolvedValueOnce({ workspace: '/home/user/project' })
      .mockResolvedValueOnce({
        session_id: 'sess-2',
        workspace: '/home/user/project',
        name: 'Test',
      })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(() => useSessionData(), { wrapper })

    await vi.waitFor(() => {
      expect(result.current.workspace).toBe('/home/user/project')
    })
    expect(result.current.sessionId).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await vi.waitFor(() => {
      expect(result.current.sessionId).toBe('sess-2')
    })
    expect(result.current.workspace).toBe('/home/user/project')

    vi.useRealTimers()
  })

  it('retries when session projection is not ready yet', async () => {
    vi.useFakeTimers()
    mockGetSession
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ session_id: 'ready-session', name: 'Ready' })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(() => useSessionData(), { wrapper })

    await vi.waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(1)
    })
    expect(result.current.sessionData).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await vi.waitFor(() => {
      expect(result.current.sessionId).toBe('ready-session')
    })

    vi.useRealTimers()
  })

  it('updates document.title with session name and workspace', async () => {
    mockEventsData = makeEventsData({ isConnected: true })

    renderHook(() => useSessionData(), { wrapper })

    await waitFor(() => {
      expect(document.title).toBe('My Session | myapp | Claudebox')
    })
  })

  it('updates document.title with only Claudebox when no session data', () => {
    mockEventsData = makeEventsData()

    renderHook(() => useSessionData(), { wrapper })

    expect(document.title).toBe('Claudebox')
  })

  it('does not expose action callbacks on data context', () => {
    const { result } = renderHook(() => useSessionData(), { wrapper })
    expect(result.current.setModel).toBeUndefined()
    expect(result.current.setPermissionMode).toBeUndefined()
    expect(result.current.setNotificationsEnabled).toBeUndefined()
    expect(result.current.refreshSession).toBeUndefined()
    expect(result.current.reloadSession).toBeUndefined()
    expect(result.current.clearSessionData).toBeUndefined()
  })

  it('clearSessionData resets sessionData to null', async () => {
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(
      () => ({ data: useSessionData(), actions: useSessionActions() }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })

    act(() => {
      result.current.actions.clearSessionData()
    })

    expect(result.current.data.sessionData).toBeNull()
    expect(result.current.data.sessionId).toBeNull()
  })

  it('reloadSession calls resumeSession, setContainerId, notifyContainerChanged, and reconnects', async () => {
    mockResumeSession.mockResolvedValue({ container_id: 'c2' })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(
      () => ({ data: useSessionData(), actions: useSessionActions() }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })

    await act(async () => {
      await result.current.actions.reloadSession()
    })

    expect(mockResumeSession).toHaveBeenCalledWith('sess-1')
    expect(mockSetContainerId).toHaveBeenCalledWith('c2')
    expect(mockNotifyContainerChanged).toHaveBeenCalled()
    expect(mockReconnectSSE).toHaveBeenCalled()
  })

  it('reloadSession calls onError when resume fails', async () => {
    mockResumeSession.mockRejectedValue(new Error('fail'))
    const onError = vi.fn()
    mockEventsData = makeEventsData({ isConnected: true })

    const errorWrapper = ({ children }) => (
      <SessionDataProvider onError={onError}>{children}</SessionDataProvider>
    )

    const { result } = renderHook(
      () => ({ data: useSessionData(), actions: useSessionActions() }),
      { wrapper: errorWrapper },
    )

    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })

    await act(async () => {
      await result.current.actions.reloadSession()
    })

    expect(onError).toHaveBeenCalledWith('Reload failed')
  })

  it('setNotificationsEnabled persists via patchSessionUiState', async () => {
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(
      () => ({ data: useSessionData(), actions: useSessionActions() }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })

    act(() => {
      result.current.actions.setNotificationsEnabled(true)
    })

    expect(result.current.data.notificationsEnabled).toBe(true)
    expect(mockPatchSessionUiState).toHaveBeenCalledWith('sess-1', [
      { op: 'set', path: 'notificationsEnabled', value: true },
    ])
  })

  it('loads notifications preference when session ID becomes available', async () => {
    mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: true } })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(() => useSessionData(), { wrapper })

    await waitFor(() => {
      expect(result.current.notificationsEnabled).toBe(true)
    })
  })

  it('calls onSessionAttach with the session id when session data loads', async () => {
    const onSessionAttach = vi.fn()
    mockEventsData = makeEventsData({ isConnected: true })

    const attachWrapper = ({ children }) => (
      <SessionDataProvider onSessionAttach={onSessionAttach}>{children}</SessionDataProvider>
    )

    renderHook(() => useSessionData(), { wrapper: attachWrapper })

    await waitFor(() => {
      expect(onSessionAttach).toHaveBeenCalledWith('sess-1')
    })
  })
})

describe('useSessionData polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(SESSION_DATA)
    mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: false } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  it('polls while isResponding is true', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    renderHook(() => useSessionData(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(3)
  })

  it('fetches once more when responding stops', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    const { rerender } = renderHook(() => useSessionData(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    mockGetSession.mockClear()

    mockEventsData = makeEventsData({ isConnected: true })
    rerender()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('does not poll when not responding', async () => {
    mockEventsData = makeEventsData({ isConnected: true })

    renderHook(() => useSessionData(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('polls at consistent intervals during sustained response', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    renderHook(() => useSessionData(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)

    for (let i = 2; i <= 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(mockGetSession).toHaveBeenCalledTimes(i)
    }
  })
})

describe('useSessionData defensive merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEventsData = makeEventsData()
    mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: false } })
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  it('preserves non-null prev fields when refresh returns same session_id with null fields', async () => {
    mockGetSession
      .mockResolvedValueOnce({
        session_id: 'sess-1',
        workspace: '/w/proj',
        model: 'opus',
        name: 'Hello',
      })
      .mockResolvedValueOnce({
        session_id: 'sess-1',
        workspace: null,
        model: null,
        name: null,
      })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderHook(
      () => ({ data: useSessionData(), actions: useSessionActions() }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })
    expect(result.current.data.workspace).toBe('/w/proj')
    expect(result.current.data.model).toBe('opus')
    expect(result.current.data.sessionName).toBe('Hello')

    await act(async () => {
      await result.current.actions.refreshSession()
    })

    expect(result.current.data.workspace).toBe('/w/proj')
    expect(result.current.data.model).toBe('opus')
    expect(result.current.data.sessionName).toBe('Hello')
  })
})

describe('useSessionData polling extra', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(SESSION_DATA)
    mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: false } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  it('stops polling interval when responding stops', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    const { rerender } = renderHook(() => useSessionData(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    const callsWhileResponding = mockGetSession.mock.calls.length

    mockEventsData = makeEventsData({ isConnected: true })
    rerender()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const callsAfterStop = mockGetSession.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockGetSession.mock.calls.length).toBe(callsAfterStop)
    expect(callsAfterStop).toBeGreaterThan(callsWhileResponding)
  })
})

describe('useSessionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEventsData = makeEventsData({ isConnected: true })
    mockGetSession.mockResolvedValue(SESSION_DATA)
    mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: false } })
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  it('throws when used outside SessionDataProvider', () => {
    expect(() => renderHook(() => useSessionActions())).toThrow(
      'useSessionActions must be used within SessionDataProvider',
    )
  })

  it('exposes all action callbacks', async () => {
    const { result } = renderHook(() => useSessionActions(), { wrapper })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })

    expect(result.current.setModel).toBeInstanceOf(Function)
    expect(result.current.setPermissionMode).toBeInstanceOf(Function)
    expect(result.current.setNotificationsEnabled).toBeInstanceOf(Function)
    expect(result.current.refreshSession).toBeInstanceOf(Function)
    expect(result.current.reloadSession).toBeInstanceOf(Function)
    expect(result.current.clearSessionData).toBeInstanceOf(Function)
  })

  it('does not expose data values on actions context', async () => {
    const { result } = renderHook(() => useSessionActions(), { wrapper })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })

    expect(result.current.sessionData).toBeUndefined()
    expect(result.current.sessionId).toBeUndefined()
    expect(result.current.sessionName).toBeUndefined()
    expect(result.current.model).toBeUndefined()
    expect(result.current.workspace).toBeUndefined()
    expect(result.current.availableModels).toBeUndefined()
  })

  it('setModel calls API then refreshes session', async () => {
    mockSetModel.mockResolvedValue({})

    const { result } = renderHook(() => useSessionActions(), { wrapper })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })

    mockGetSession.mockClear()

    act(() => {
      result.current.setModel('claude-4')
    })

    expect(mockSetModel).toHaveBeenCalledWith('claude-4')

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })
  })

  it('setPermissionMode calls API then refreshes session', async () => {
    mockSetPermissionMode.mockResolvedValue({})

    const { result } = renderHook(() => useSessionActions(), { wrapper })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })

    mockGetSession.mockClear()

    act(() => {
      result.current.setPermissionMode('plan')
    })

    expect(mockSetPermissionMode).toHaveBeenCalledWith('plan')

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })
  })

  it('setModel buffers when no container is active (welcome screen)', async () => {
    mockGetContainerId.mockReturnValue(null)
    // No session yet — getSession returns workspace info only.
    mockGetSession.mockResolvedValue({ workspace: '/path' })

    const { result } = renderHook(() => useSessionActions(), { wrapper })

    act(() => {
      result.current.setModel('claude-4')
    })

    // Buffered — the effort/model API was NOT called yet.
    expect(mockSetModel).not.toHaveBeenCalled()
  })

  it('setEffortLevel buffers when no container is active (welcome screen)', async () => {
    mockGetContainerId.mockReturnValue(null)
    mockGetSession.mockResolvedValue({ workspace: '/path' })

    const { result } = renderHook(() => useSessionActions(), { wrapper })

    act(() => {
      result.current.setEffortLevel('max')
    })

    expect(mockSetEffortLevel).not.toHaveBeenCalled()
  })

  it('latest-wins: repeated buffered setModel calls only the latest value drains', async () => {
    mockGetContainerId.mockReturnValue(null)

    const { result } = renderHook(() => useSessionActions(), { wrapper })

    act(() => {
      result.current.setModel('claude-3')
      result.current.setModel('claude-haiku')
      result.current.setModel('claude-opus')
    })

    // While buffered, no API calls happen.
    expect(mockSetModel).not.toHaveBeenCalled()

    // Simulate session attach: getContainerId now returns a real id, the
    // session-id projection arrives. The drain effect should flush only the
    // latest value.
    mockGetContainerId.mockReturnValue('test-container')
    mockSetModel.mockResolvedValue({})
    mockGetSession.mockResolvedValue(SESSION_DATA)
    await act(async () => {
      await result.current.refreshSession()
    })

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledTimes(1)
    })
    expect(mockSetModel).toHaveBeenCalledWith('claude-opus')
  })

  it('drains buffered config in strict order on session attach: model → permission → effort', async () => {
    const callOrder = []
    mockSetModel.mockImplementation(async value => {
      callOrder.push(['model', value])
    })
    mockSetPermissionMode.mockImplementation(async value => {
      callOrder.push(['permission', value])
    })
    mockSetEffortLevel.mockImplementation(async value => {
      callOrder.push(['effort', value])
    })

    mockGetContainerId.mockReturnValue(null)
    mockGetSession.mockResolvedValue({ workspace: '/path' })

    const { result } = renderHook(
      () => ({ actions: useSessionActions(), data: useSessionData() }),
      { wrapper },
    )

    act(() => {
      result.current.actions.setEffortLevel('max')
      result.current.actions.setPermissionMode('plan')
      result.current.actions.setModel('claude-haiku')
    })

    // Session attach: getSession now returns a session_id. The drain effect
    // keys on the null → set transition.
    mockGetContainerId.mockReturnValue('test-container')
    mockGetSession.mockResolvedValue(SESSION_DATA)
    await act(async () => {
      await result.current.actions.refreshSession()
    })

    await waitFor(() => {
      expect(callOrder.length).toBe(3)
    })
    expect(callOrder.map(c => c[0])).toEqual(['model', 'permission', 'effort'])
    expect(callOrder).toEqual([
      ['model', 'claude-haiku'],
      ['permission', 'plan'],
      ['effort', 'max'],
    ])
  })

  it('refreshSession fetches session data and updates data context', async () => {
    const { result } = renderHook(
      () => ({ data: useSessionData(), actions: useSessionActions() }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })

    mockGetSession.mockResolvedValue({ ...SESSION_DATA, name: 'Updated' })

    await act(async () => {
      await result.current.actions.refreshSession()
    })

    expect(result.current.data.sessionName).toBe('Updated')
  })
})
