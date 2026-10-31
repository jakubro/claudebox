/** Tests for SessionDataContext (read-only data). */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../utils/deferred'
import { SessionDataProvider, useSessionActions, useSessionData } from './SessionDataContext'

const mockGetSession = vi.fn()
const mockResumeSession = vi.fn()
const mockGetUiState = vi.fn()
const mockPatchSessionUiState = vi.fn()
const mockSetModel = vi.fn()
const mockSetPermissionMode = vi.fn()
const mockSetEffortLevel = vi.fn()
const mockSetAddress = vi.fn()
// Defaults to a present container so picker setters take the API-direct path; welcome-screen
// buffer tests override with `.mockReturnValue(null)`.
const mockGetContainerId = vi.fn(() => 'test-container')
const mockGetAddressedSessionId = vi.fn(() => 'test-session')

vi.mock('../api/apiClient', () => ({
  setAddress: (...args) => mockSetAddress(...args),
  getContainerId: (...args) => mockGetContainerId(...args),
  getAddressedSessionId: (...args) => mockGetAddressedSessionId(...args),
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

vi.mock('./DaemonStreamContext', () => ({
  useDaemonStreamContext: () => ({ sessionsChanged: 0 }),
}))

const mockReconnectSSE = vi.fn()
const mockNotifyAddressChanged = vi.fn()
const makeEventsData = (overrides = {}) => ({
  isConnected: false,
  isResponding: false,
  reconnectSSE: mockReconnectSSE,
  notifyAddressChanged: mockNotifyAddressChanged,
  creations: { current: 0, bySeq: {} },
  getCreation: () => mockEventsData.creations,
  isResumeRequestPending: false,
  isCreateRequestPending: false,
  ...overrides,
})
let mockEventsData = makeEventsData()
vi.mock('./EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

let mockRoutedSessionId = null
vi.mock('./SessionRoutingContext', () => ({
  useSessionRouting: () => ({ activeSessionId: mockRoutedSessionId }),
}))

beforeEach(() => {
  mockRoutedSessionId = null
})

// The welcome screen's first creation, created as sess-1 and not yet reached by the route.
const FIRST_CREATION_DONE = {
  current: 1,
  bySeq: { 1: { status: 'created', sessionId: 'sess-1', fromRoute: null } },
}

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

function resetSessionMocks() {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(SESSION_DATA)
  mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: false } })
}

function renderSessionHooks(wrapper) {
  return renderHook(() => ({ data: useSessionData(), actions: useSessionActions() }), { wrapper })
}

function mockAttached({ creations, session = SESSION_DATA } = {}) {
  mockEventsData = makeEventsData({ isConnected: true, ...(creations && { creations }) })
  mockGetContainerId.mockReturnValue('test-container')
  mockGetSession.mockResolvedValue(session)
}

function renderWelcome(wrapper, session = { workspace: '/path' }) {
  mockGetContainerId.mockReturnValue(null)
  mockGetSession.mockResolvedValue(session)

  return renderSessionHooks(wrapper)
}

async function renderLoadedSession(wrapper) {
  const hook = renderSessionHooks(wrapper)
  await waitFor(() => {
    expect(hook.result.current.data.sessionId).toBe('sess-1')
  })

  return hook
}

async function renderAndFlush(wrapper) {
  const hook = renderHook(() => useSessionData(), { wrapper })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

  return hook
}

function renderWithWelcomePick(wrapper) {
  mockGetContainerId.mockReturnValue(null)
  const hook = renderHook(() => ({ actions: useSessionActions(), data: useSessionData() }), {
    wrapper,
  })
  act(() => {
    hook.result.current.actions.setModel('claude-sonnet-5')
  })

  return hook
}

function deferGetSession() {
  const settlers = []
  mockGetSession.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        settlers.push({ resolve, reject })
      }),
  )

  return settlers
}

describe('useSessionData', () => {
  beforeEach(() => {
    resetSessionMocks()
    mockEventsData = makeEventsData()
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
    mockGetAddressedSessionId.mockReturnValue('test-session')
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

    const { result } = await renderLoadedSession(wrapper)

    act(() => {
      result.current.actions.clearSessionData()
    })

    expect(result.current.data.sessionData).toBeNull()
    expect(result.current.data.sessionId).toBeNull()
  })

  it('reloadSession calls resumeSession, setAddress, notifyAddressChanged, and reconnects', async () => {
    mockRoutedSessionId = 'sess-1'
    mockResumeSession.mockResolvedValue({ container_id: 'c2' })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = await renderLoadedSession(wrapper)

    await act(async () => {
      await result.current.actions.reloadSession()
    })

    expect(mockResumeSession).toHaveBeenCalledWith('sess-1')
    expect(mockSetAddress).toHaveBeenCalledWith('c2', 'sess-1')
    expect(mockNotifyAddressChanged).toHaveBeenCalled()
    expect(mockReconnectSSE).toHaveBeenCalled()
  })

  it('reloadSession calls onError when resume fails', async () => {
    mockRoutedSessionId = 'sess-1'
    mockResumeSession.mockRejectedValue(new Error('fail'))
    const onError = vi.fn()
    mockEventsData = makeEventsData({ isConnected: true })

    const errorWrapper = ({ children }) => (
      <SessionDataProvider onError={onError}>{children}</SessionDataProvider>
    )

    const { result } = renderSessionHooks(errorWrapper)

    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })

    await act(async () => {
      await result.current.actions.reloadSession()
    })

    expect(onError).toHaveBeenCalledWith('Reload failed')
  })

  async function attachedOnSess1(onError) {
    mockRoutedSessionId = 'sess-1'
    mockEventsData = makeEventsData({ isConnected: true })
    const hook = renderSessionHooks(({ children }) => (
      <SessionDataProvider onError={onError}>{children}</SessionDataProvider>
    ))
    await waitFor(() => expect(hook.result.current.data.sessionId).toBe('sess-1'))
    return hook
  }

  it('a reload settling after a move leaves the tab where it is', async () => {
    let release
    mockResumeSession.mockReturnValue(new Promise(resolve => (release = resolve)))
    const { result, rerender } = await attachedOnSess1()

    let reload
    act(() => {
      reload = result.current.actions.reloadSession()
    })
    mockRoutedSessionId = 'sess-2'
    rerender()
    await act(async () => {
      release({ container_id: 'c2' })
      await reload
    })

    expect(mockSetAddress).not.toHaveBeenCalledWith('c2', 'sess-1')
    expect(mockReconnectSSE).not.toHaveBeenCalled()
  })

  it('a reload callback captured before a move does nothing', async () => {
    const { result, rerender } = await attachedOnSess1()
    const reload = result.current.actions.reloadSession

    mockRoutedSessionId = 'sess-2'
    rerender()
    await act(async () => {
      await reload()
    })

    expect(mockResumeSession).not.toHaveBeenCalled()
  })

  it('a reload failing after a move shows nothing', async () => {
    let fail
    mockResumeSession.mockReturnValue(new Promise((_, reject) => (fail = reject)))
    const onError = vi.fn()
    const { result, rerender } = await attachedOnSess1(onError)

    let reload
    act(() => {
      reload = result.current.actions.reloadSession()
    })
    mockRoutedSessionId = 'sess-2'
    rerender()
    await act(async () => {
      fail(new Error('gone'))
      await reload
    })

    expect(onError).not.toHaveBeenCalled()
  })

  it('setNotificationsEnabled persists via patchSessionUiState', async () => {
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = await renderLoadedSession(wrapper)

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
    mockGetAddressedSessionId.mockReturnValue('test-session')
    vi.useFakeTimers()
    resetSessionMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  it('polls while isResponding is true', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    await renderAndFlush(wrapper)

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

  it('does not start a second request while one is still in flight', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })
    mockGetSession.mockReturnValue(new Promise(() => {}))

    await renderAndFlush(wrapper)

    expect(mockGetSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('does not join an in-flight request addressed to a different container', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })
    mockGetSession.mockReturnValue(new Promise(() => {}))

    await renderAndFlush(wrapper)

    expect(mockGetSession).toHaveBeenCalledTimes(1)

    mockGetContainerId.mockReturnValue('other-container')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(2)
  })

  it('does not join an in-flight request addressed to another session in the same container', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })
    mockGetSession.mockReturnValue(new Promise(() => {}))

    await renderAndFlush(wrapper)

    expect(mockGetSession).toHaveBeenCalledTimes(1)

    mockGetAddressedSessionId.mockReturnValue('thread-session')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(2)
  })

  it('drops a reply for the session left when the container stays the same', async () => {
    const left = createDeferred()
    mockEventsData = makeEventsData({ isConnected: true })
    mockGetSession.mockReturnValueOnce(left.promise)

    const { result } = renderHook(() => useSessionData(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    mockGetAddressedSessionId.mockReturnValue('thread-session')

    await act(async () => {
      left.resolve({ ...SESSION_DATA, session_id: 'test-session' })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.sessionId).toBeNull()
  })

  it('fetches once more when responding stops', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    const { rerender } = await renderAndFlush(wrapper)

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

    await renderAndFlush(wrapper)

    expect(mockGetSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('polls at consistent intervals during sustained response', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    await renderAndFlush(wrapper)

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

    const { result } = await renderLoadedSession(wrapper)
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

  it('lets a refresh clear needs_user while other null fields keep their values', async () => {
    mockGetSession
      .mockResolvedValueOnce({
        session_id: 'sess-1',
        model: 'opus',
        needs_user: 'Decide: where retry state lives',
      })
      .mockResolvedValueOnce({ session_id: 'sess-1', model: null, needs_user: null })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderSessionHooks(wrapper)

    await waitFor(() => {
      expect(result.current.data.sessionData?.needs_user).toBe('Decide: where retry state lives')
    })

    await act(async () => {
      await result.current.actions.refreshSession()
    })

    expect(result.current.data.sessionData.needs_user).toBeNull()
    expect(result.current.data.model).toBe('opus')
  })

  it('lets a refresh clear needs_user_replies', async () => {
    mockGetSession
      .mockResolvedValueOnce({
        session_id: 'sess-1',
        needs_user: 'Approve: file it',
        needs_user_replies: ['Go', 'Hold'],
      })
      .mockResolvedValueOnce({ session_id: 'sess-1', needs_user: null, needs_user_replies: null })
    mockEventsData = makeEventsData({ isConnected: true })

    const { result } = renderSessionHooks(wrapper)

    await waitFor(() => {
      expect(result.current.data.sessionData?.needs_user_replies).toEqual(['Go', 'Hold'])
    })

    await act(async () => {
      await result.current.actions.refreshSession()
    })

    expect(result.current.data.sessionData.needs_user_replies).toBeNull()
  })
})

describe('useSessionData polling extra', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSessionMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  it('stops polling interval when responding stops', async () => {
    mockEventsData = makeEventsData({ isConnected: true, isResponding: true })

    const { rerender } = await renderAndFlush(wrapper)

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
    resetSessionMocks()
    mockEventsData = makeEventsData({ isConnected: true })
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

    mockRoutedSessionId = 'sess-1'
    const { result } = await renderLoadedSession(wrapper)

    mockGetSession.mockClear()

    act(() => {
      result.current.actions.setModel('claude-4')
    })

    expect(mockSetModel).toHaveBeenCalledWith('claude-4')

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })
  })

  it('setPermissionMode calls API then refreshes session', async () => {
    mockSetPermissionMode.mockResolvedValue({})

    mockRoutedSessionId = 'sess-1'
    const { result } = await renderLoadedSession(wrapper)

    mockGetSession.mockClear()

    act(() => {
      result.current.actions.setPermissionMode('plan')
    })

    expect(mockSetPermissionMode).toHaveBeenCalledWith('plan')

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })
  })

  it('a refused permission mode is reported and settles after the confirming refresh', async () => {
    mockSetPermissionMode.mockRejectedValue(new Error('Failed to apply permission mode'))
    const onError = vi.fn()
    mockRoutedSessionId = 'sess-1'
    const { result } = renderHook(
      () => ({ actions: useSessionActions(), data: useSessionData() }),
      {
        wrapper: ({ children }) => (
          <SessionDataProvider onError={onError}>{children}</SessionDataProvider>
        ),
      },
    )
    await waitFor(() => {
      expect(result.current.data.sessionId).toBe('sess-1')
    })
    let refreshed = false
    mockGetSession.mockClear()
    mockGetSession.mockImplementation(async () => {
      refreshed = true
      return SESSION_DATA
    })

    await act(async () => {
      await result.current.actions.setPermissionMode('bypassPermissions')
      expect(refreshed).toBe(true)
    })

    expect(onError).toHaveBeenCalledWith('Failed to apply permission mode')
  })

  it('setModel buffers when no container is active (welcome screen)', async () => {
    const { result } = renderWelcome(wrapper)

    act(() => {
      result.current.actions.setModel('claude-4')
    })

    // Buffered - the effort/model API was NOT called yet.
    expect(mockSetModel).not.toHaveBeenCalled()
  })

  it('setEffortLevel buffers when no container is active (welcome screen)', async () => {
    const { result } = renderWelcome(wrapper)

    act(() => {
      result.current.actions.setEffortLevel('max')
    })

    expect(mockSetEffortLevel).not.toHaveBeenCalled()
  })

  it('latest-wins: repeated buffered setModel calls only the latest value drains', async () => {
    const { result } = renderWelcome(wrapper, SESSION_DATA)

    act(() => {
      result.current.actions.setModel('claude-3')
      result.current.actions.setModel('claude-haiku')
      result.current.actions.setModel('claude-opus')
    })

    // While buffered, no API calls happen.
    expect(mockSetModel).not.toHaveBeenCalled()

    mockSetModel.mockResolvedValue({})
    mockAttached({ creations: FIRST_CREATION_DONE })
    await act(async () => {
      await result.current.actions.refreshSession()
    })

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledTimes(1)
    })
    expect(mockSetModel).toHaveBeenCalledWith('claude-opus', expect.anything())
  })

  it('drains buffered config in strict order on session attach: model -> permission -> effort', async () => {
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

    const { result } = renderWelcome(wrapper)

    act(() => {
      result.current.actions.setEffortLevel('max')
      result.current.actions.setPermissionMode('plan')
      result.current.actions.setModel('claude-haiku')
    })

    mockAttached({ creations: FIRST_CREATION_DONE })
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

  it('buffers a pick made while the routed session opens from another, then applies it there', async () => {
    mockRoutedSessionId = 'sess-1'
    mockSetModel.mockResolvedValue({})
    const { result, rerender } = await renderLoadedSession(wrapper)

    // Session B is routed and opening; the tab still addresses sess-1's container.
    mockRoutedSessionId = 'sess-b'
    mockEventsData = makeEventsData({ isConnected: true, isResumeRequestPending: true })
    rerender()
    act(() => {
      result.current.actions.setModel('claude-sonnet-5')
    })
    expect(mockSetModel).not.toHaveBeenCalled()

    // The open settles: data clears, B's own data arrives.
    mockEventsData = makeEventsData({ isConnected: true })
    act(() => {
      result.current.actions.clearSessionData()
    })
    mockGetSession.mockResolvedValue({ ...SESSION_DATA, session_id: 'sess-b' })
    await act(async () => {
      await result.current.actions.refreshSession()
    })

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith('claude-sonnet-5', expect.anything())
    })
    expect(result.current.data.sessionId).toBe('sess-b')
  })

  it('buffers a pick made during a create from another session for the new session', async () => {
    mockRoutedSessionId = 'sess-1'
    mockSetEffortLevel.mockResolvedValue({})
    const { result, rerender } = await renderLoadedSession(wrapper)

    act(() => {
      result.current.actions.clearSessionData()
    })
    mockEventsData = makeEventsData({
      isConnected: true,
      isCreateRequestPending: true,
      creations: {
        current: 1,
        bySeq: { 1: { status: 'pending', sessionId: null, fromRoute: 'sess-1' } },
      },
    })
    rerender()
    act(() => {
      result.current.actions.setEffortLevel('max')
    })
    expect(mockSetEffortLevel).not.toHaveBeenCalled()

    mockEventsData = makeEventsData({
      isConnected: true,
      creations: {
        current: 1,
        bySeq: { 1: { status: 'created', sessionId: 'sess-new', fromRoute: 'sess-1' } },
      },
    })
    act(() => {
      result.current.actions.seedSessionData({ ...SESSION_DATA, session_id: 'sess-new' })
    })

    await waitFor(() => {
      expect(mockSetEffortLevel).toHaveBeenCalledWith('max', expect.anything())
    })
  })

  it('drops a welcome pick when an existing session is opened instead', async () => {
    const { result, rerender } = renderWithWelcomePick(wrapper)
    expect(result.current.data.pendingModel).toBe('claude-sonnet-5')

    mockRoutedSessionId = 'sess-9'
    mockAttached({ session: { ...SESSION_DATA, session_id: 'sess-9' } })
    rerender()
    await act(async () => {
      await result.current.actions.refreshSession()
    })

    await waitFor(() => {
      expect(result.current.data.pendingModel).toBeNull()
    })
    expect(mockSetModel).not.toHaveBeenCalled()
  })

  it('does not hand a pick for the next creation to an earlier one the tab opens', async () => {
    const routedFirst = {
      current: 1,
      bySeq: { 1: { status: 'routed', sessionId: 'sess-1', fromRoute: null } },
    }
    mockEventsData = makeEventsData({ creations: routedFirst })
    const { result, rerender } = renderWithWelcomePick(wrapper)

    mockRoutedSessionId = 'sess-1'
    mockAttached({ creations: routedFirst })
    rerender()
    await act(async () => {
      await result.current.actions.refreshSession()
    })

    await waitFor(() => {
      expect(result.current.data.pendingModel).toBeNull()
    })
    expect(mockSetModel).not.toHaveBeenCalled()
  })

  it('keeps welcome picks through a failed creation for the next one', async () => {
    mockSetModel.mockResolvedValue({})
    const { result, rerender } = renderWithWelcomePick(wrapper)

    mockEventsData = makeEventsData({
      creations: {
        current: 1,
        bySeq: { 1: { status: 'failed', sessionId: null, fromRoute: null } },
      },
    })
    rerender()
    expect(result.current.data.pendingModel).toBe('claude-sonnet-5')

    mockAttached({
      creations: {
        current: 2,
        bySeq: {
          1: { status: 'failed', sessionId: null, fromRoute: null },
          2: { status: 'created', sessionId: 'sess-1', fromRoute: null },
        },
      },
    })
    rerender()
    await act(async () => {
      await result.current.actions.refreshSession()
    })

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith('claude-sonnet-5', expect.anything())
    })
  })

  it('shows a welcome pick until the session it was applied to confirms it', async () => {
    let confirmModel
    mockSetModel.mockReturnValue(
      new Promise(resolve => {
        confirmModel = resolve
      }),
    )
    const { result, rerender } = renderWithWelcomePick(wrapper)

    mockAttached({ creations: FIRST_CREATION_DONE })
    rerender()
    await act(async () => {
      await result.current.actions.refreshSession()
    })

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith('claude-sonnet-5', expect.anything())
    })
    expect(result.current.data.model).toBe('claude-3')
    expect(result.current.data.pendingModel).toBe('claude-sonnet-5')
    expect(result.current.data.isApplyingPendingConfig).toBe(true)

    mockGetSession.mockResolvedValue({ ...SESSION_DATA, model: 'claude-sonnet-5' })
    await act(async () => {
      confirmModel({})
    })

    await waitFor(() => {
      expect(result.current.data.isApplyingPendingConfig).toBe(false)
    })
    expect(result.current.data.pendingModel).toBeNull()
    expect(result.current.data.model).toBe('claude-sonnet-5')
  })

  it('refreshSession fetches session data and updates data context', async () => {
    const { result } = await renderLoadedSession(wrapper)

    mockGetSession.mockResolvedValue({ ...SESSION_DATA, name: 'Updated' })

    await act(async () => {
      await result.current.actions.refreshSession()
    })

    expect(result.current.data.sessionName).toBe('Updated')
  })
})

describe('refreshSession joiner promise contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // isConnected: false - the provider's own initial-fetch effect must stay silent so every
    // refreshSession() call in these tests is the one driving the assertions, not a joiner of it.
    mockEventsData = makeEventsData({ isConnected: false })
    mockGetUiState.mockResolvedValue({ session: { notificationsEnabled: false } })
    mockGetContainerId.mockReturnValue('test-container')
  })

  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>

  async function startFirstRefresh() {
    const settlers = deferGetSession()
    const { result } = renderSessionHooks(wrapper)
    const { refreshSession } = result.current.actions
    const first = refreshSession()
    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(1)
    })

    return { settlers, result, refreshSession, first }
  }

  it('does not resolve a joiner until the re-armed refetch settles, then reads its state', async () => {
    const { settlers, result, refreshSession, first } = await startFirstRefresh()
    let joinerSettled = false

    const joiner = refreshSession().then(() => {
      joinerSettled = true
    })

    await act(async () => {
      settlers[0].resolve(SESSION_DATA)
      await first
    })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(2)
    })

    // The first request settled and the re-arm issued a second one - the joiner must still be
    // waiting on that second request, not already resolved on the one it joined.
    expect(joinerSettled).toBe(false)

    await act(async () => {
      settlers[1].resolve({ ...SESSION_DATA, name: 'Updated' })
      await joiner
    })

    expect(joinerSettled).toBe(true)
    // The joiner awaited state as of its own call, which the second (re-armed) response reflects.
    expect(result.current.data.sessionName).toBe('Updated')
  })

  it('resolves an unjoined caller on its own request, with no extra round trip', async () => {
    mockGetSession.mockResolvedValue(SESSION_DATA)

    const { result } = renderHook(() => useSessionActions(), { wrapper })

    await act(async () => {
      await result.current.refreshSession()
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('waits for the re-armed refetch even when it errors, rather than settling on the joined one', async () => {
    const { settlers, refreshSession, first } = await startFirstRefresh()

    let joinerSettled = false
    const joiner = refreshSession().finally(() => {
      joinerSettled = true
    })

    await act(async () => {
      settlers[0].resolve(SESSION_DATA)
      await first
    })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(2)
    })

    // The first request succeeded, but the joiner must still be waiting on the re-armed second
    // one - even though that errors internally and refreshSession swallows it without retrying.
    expect(joinerSettled).toBe(false)

    await act(async () => {
      settlers[1].reject(new Error('network down'))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await waitFor(() => {
      expect(joinerSettled).toBe(true)
    })

    await expect(joiner).resolves.toBeUndefined()
  })

  it('settles an orphaned joiner when its container is switched away, without a spurious extra fetch', async () => {
    const { settlers, refreshSession, first } = await startFirstRefresh()

    let joinerSettled = false
    act(() => {
      refreshSession().then(() => {
        joinerSettled = true
      })
    })

    // Container switch: the next call is addressed elsewhere, so it cannot join call #1 - it
    // must find call #1's joiner orphaned and settle it immediately rather than carry it forward.
    mockGetContainerId.mockReturnValue('other-container')

    act(() => {
      refreshSession()
    })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(2)
    })

    expect(joinerSettled).toBe(true)

    // Call #1 settling late, with ownership already lost, must not add a third, unsolicited call.
    await act(async () => {
      settlers[0].resolve(SESSION_DATA)
      await first
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(mockGetSession).toHaveBeenCalledTimes(2)
  })

  it('drops a read that lands after the session it addressed was released', async () => {
    let resolveRead
    mockGetSession.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRead = resolve
        }),
    )
    const { result } = renderSessionHooks(wrapper)
    const read = result.current.actions.refreshSession()
    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(1)
    })

    mockGetContainerId.mockReturnValue(null)
    await act(async () => {
      resolveRead(SESSION_DATA)
      await read
    })

    expect(result.current.data.sessionData).toBeNull()
  })

  it('applies a read whose container is still the current one - a guard', async () => {
    mockGetSession.mockResolvedValue(SESSION_DATA)
    const { result } = renderSessionHooks(wrapper)

    await act(async () => {
      await result.current.actions.refreshSession()
    })

    expect(result.current.data.sessionId).toBe('sess-1')
  })

  it('does not apply a stale container response to sessionData when the container is switched mid-flight', async () => {
    const { settlers, result, refreshSession, first } = await startFirstRefresh()

    // Container switch before call #1 settles - its response must not paint sessionData for the
    // container reading it now.
    mockGetContainerId.mockReturnValue('other-container')

    act(() => {
      refreshSession()
    })

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      settlers[0].resolve({ ...SESSION_DATA, name: 'stale-container-1-session' })
      await first
    })

    // Call #1's response never reached sessionData - call #2's own request is still pending.
    expect(result.current.data.sessionData).toBeNull()

    await act(async () => {
      settlers[1].resolve({ ...SESSION_DATA, name: 'other-container-session' })
    })

    await waitFor(() => {
      expect(result.current.data.sessionName).toBe('other-container-session')
    })
  })

  it('a stale container response that rejects does not corrupt the newer container run or report onError', async () => {
    vi.useFakeTimers()

    try {
      mockEventsData = makeEventsData({ isConnected: true })
      const onError = vi.fn()
      const errorWrapper = ({ children }) => (
        <SessionDataProvider onError={onError}>{children}</SessionDataProvider>
      )

      const settlers = deferGetSession()

      const { result } = renderHook(() => useSessionActions(), { wrapper: errorWrapper })
      const { refreshSession } = result.current

      refreshSession()
      await vi.waitFor(() => {
        expect(mockGetSession).toHaveBeenCalledTimes(1)
      })

      // Container switch: the next call is addressed elsewhere, so call #1 is superseded.
      mockGetContainerId.mockReturnValue('other-container')
      act(() => {
        refreshSession()
      })
      await vi.waitFor(() => {
        expect(mockGetSession).toHaveBeenCalledTimes(2)
      })

      // Call #1's stale rejection must not schedule a retry: it would join container #2's
      // in-flight request and arm a re-fetch that fires again once #2 settles.
      await act(async () => {
        settlers[0].reject(new Error('stale container network error'))
        await vi.advanceTimersByTimeAsync(10000)
      })

      // Container #2's own response settles normally - no unsolicited re-arm fetch should follow.
      await act(async () => {
        settlers[1].resolve(SESSION_DATA)
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockGetSession).toHaveBeenCalledTimes(2)
      expect(onError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('notifications preference across a session switch', () => {
  const wrapper = ({ children }) => <SessionDataProvider>{children}</SessionDataProvider>
  let reads

  beforeEach(() => {
    vi.clearAllMocks()
    mockEventsData = makeEventsData()
    mockGetContainerId.mockReturnValue(null)
    reads = { A: createDeferred(), B: createDeferred() }
    mockGetUiState.mockImplementation(id => reads[id].promise)
  })

  function attachedTo(sessionId) {
    const hook = renderSessionHooks(wrapper)
    act(() => {
      hook.result.current.actions.seedSessionData({ ...SESSION_DATA, session_id: sessionId })
    })

    return hook
  }

  function switchTo(result, sessionId) {
    act(() => {
      result.current.actions.clearSessionData()
    })
    act(() => {
      result.current.actions.seedSessionData({ ...SESSION_DATA, session_id: sessionId })
    })
  }

  it('drops a late reply for the session left, and shows off while the next one loads', async () => {
    const { result } = attachedTo('A')
    switchTo(result, 'B')
    expect(result.current.data.notificationsEnabled).toBe(false)

    await act(async () => {
      reads.B.resolve({ session: { notificationsEnabled: false } })
    })
    await act(async () => {
      reads.A.resolve({ session: { notificationsEnabled: true } })
    })

    expect(result.current.data.notificationsEnabled).toBe(false)
  })

  it('keeps a toggle made while the session reads its own value', async () => {
    const { result } = attachedTo('B')
    act(() => {
      result.current.actions.setNotificationsEnabled(true)
    })

    await act(async () => {
      reads.B.resolve({ session: { notificationsEnabled: false } })
    })

    expect(result.current.data.notificationsEnabled).toBe(true)
  })
})
