/** Tests for SessionsContext. */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PINS_CHANGE_SIGNAL_KEY, SESSION_STORAGE_SWEEP_AT_KEY } from '../config/storage'
import { SESSIONS_CHANGED_DEBOUNCE_MS, SESSIONS_REFRESH_FALLBACK_MS } from '../config/timing'
import { createDeferred } from '../utils/deferred'

const mockWorkspaceCtx = { workspaceId: 'ws-1' }
vi.mock('./WorkspaceContext', () => ({ useWorkspace: () => mockWorkspaceCtx }))

const mockDaemonCtx = { sessionsChanged: 0, changesByWorkspace: {} }
vi.mock('./DaemonStreamContext', () => ({ useDaemonStreamContext: () => mockDaemonCtx }))

vi.mock('../api/sessions', () => ({ listSessions: vi.fn(), listSessionsForWorkspace: vi.fn() }))
vi.mock('../api/uiState', () => ({ getUiState: vi.fn(), patchGlobalUiState: vi.fn() }))
vi.mock('../api/workspaces', () => ({ listWorkspaces: vi.fn() }))

import { listSessions, listSessionsForWorkspace } from '../api/sessions'
import { getUiState, patchGlobalUiState } from '../api/uiState'
import { listWorkspaces } from '../api/workspaces'
import { SessionsProvider, useSessionsList } from './SessionsContext'

function TestConsumer() {
  const ctx = useSessionsList()
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="sessions">{ctx.sessions.length}</span>
      <span data-testid="pinned">{JSON.stringify(ctx.pinnedSessions)}</span>
      <span data-testid="color">{ctx.workspaceColor || 'none'}</span>
      <span data-testid="error">{ctx.error || 'none'}</span>
      <span data-testid="panel-filter">{ctx.panelFilter}</span>
      <span data-testid="panel-filter-pick">{ctx.panelFilterPick}</span>
      <button type="button" data-testid="refresh" onClick={ctx.refresh}>
        Refresh
      </button>
      <button type="button" data-testid="pin" onClick={() => ctx.togglePin('s1')}>
        Pin
      </button>
      <button
        type="button"
        data-testid="set-color"
        onClick={() => ctx.setWorkspaceColor('#ff0000')}>
        Color
      </button>
      <button type="button" data-testid="clear-color" onClick={() => ctx.setWorkspaceColor(null)}>
        Clear
      </button>
      <button type="button" data-testid="pick-named" onClick={() => ctx.setPanelFilter('named')}>
        Pick Named
      </button>
      <button type="button" data-testid="fallback-on" onClick={() => ctx.setFallbackToAll(true)}>
        Fallback On
      </button>
      <button type="button" data-testid="fallback-off" onClick={() => ctx.setFallbackToAll(false)}>
        Fallback Off
      </button>
    </div>
  )
}

function MountingPanel() {
  const { revalidate } = useSessionsList()
  useEffect(() => {
    revalidate()
  }, [revalidate])
  return null
}

function holdNextList() {
  let resolveList
  listSessions.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveList = resolve
      }),
  )

  return value => resolveList(value)
}

function renderWithProvider() {
  return render(
    <SessionsProvider>
      <TestConsumer />
    </SessionsProvider>,
  )
}

async function renderLoaded() {
  const user = userEvent.setup()
  renderWithProvider()
  await waitFor(() => {
    expect(screen.getByTestId('loading').textContent).toBe('false')
  })

  return user
}

async function renderLoadedAfterClick(control, field, value) {
  const user = await renderLoaded()
  await user.click(screen.getByTestId(control))
  await waitFor(() => {
    expect(screen.getByTestId(field).textContent).toBe(value)
  })

  return user
}

async function renderSettledOnFakeTimers(ageMs = 0) {
  const view = renderWithProvider()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ageMs)
  })
  listSessions.mockClear()

  return view
}

async function renderSessionsHook(count) {
  const { result } = renderHook(() => useSessionsList(), {
    wrapper: ({ children }) => <SessionsProvider>{children}</SessionsProvider>,
  })
  await waitFor(() => expect(result.current.sessions).toHaveLength(count))

  return result
}

describe('SessionsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockWorkspaceCtx.workspaceId = 'ws-1'
    mockDaemonCtx.sessionsChanged = 0
    mockDaemonCtx.changesByWorkspace = {}
    listSessions.mockResolvedValue({ sessions: [{ session_id: 's1' }] })
    getUiState.mockResolvedValue({ global: { pinnedSessions: [], workspaceColor: null } })
    listWorkspaces.mockRejectedValue(new Error('not registered in this test'))
    listSessionsForWorkspace.mockRejectedValue(new Error('not registered in this test'))
  })

  it('fetches sessions on mount and renders them', async () => {
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('sessions').textContent).toBe('1')
    })
    expect(listSessions).toHaveBeenCalled()
  })

  it('shows loading=false after fetch completes', async () => {
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
  })

  it('sets error on fetch failure', async () => {
    listSessions.mockRejectedValue(new Error('Network error'))

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Network error')
    })
  })

  it('does not fetch when workspaceId is null', async () => {
    mockWorkspaceCtx.workspaceId = null

    renderWithProvider()

    // Give it a tick to ensure fetch is not called
    await waitFor(() => {
      expect(listSessions).not.toHaveBeenCalled()
    })
  })

  it('togglePin adds sessionId to pinned list and calls patchGlobalUiState with add op', async () => {
    const user = await renderLoaded()

    await user.click(screen.getByTestId('pin'))

    await waitFor(() => {
      expect(screen.getByTestId('pinned').textContent).toBe('["s1"]')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([
      { op: 'add', path: 'pinnedSessions', value: 's1' },
    ])
  })

  it('togglePin removes sessionId from pinned list when already pinned', async () => {
    const user = await renderLoadedAfterClick('pin', 'pinned', '["s1"]')

    await user.click(screen.getByTestId('pin'))
    await waitFor(() => {
      expect(screen.getByTestId('pinned').textContent).toBe('[]')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([
      { op: 'remove', path: 'pinnedSessions', value: 's1' },
    ])
  })

  it('togglePin signals other tabs via the pins-changed key only after the write lands', async () => {
    const write = createDeferred()
    patchGlobalUiState.mockReturnValueOnce(write.promise)
    renderWithProvider()
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    fireEvent.click(screen.getByTestId('pin'))
    await Promise.resolve()
    expect(setItem).not.toHaveBeenCalledWith(PINS_CHANGE_SIGNAL_KEY, expect.any(String))

    await act(async () => write.resolve())
    expect(setItem).toHaveBeenCalledWith(PINS_CHANGE_SIGNAL_KEY, expect.any(String))
    setItem.mockRestore()
  })

  it('togglePin writes and signals once under StrictMode', async () => {
    render(
      <SessionsProvider>
        <TestConsumer />
      </SessionsProvider>,
      { reactStrictMode: true },
    )
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await act(async () => fireEvent.click(screen.getByTestId('pin')))

    expect(patchGlobalUiState).toHaveBeenCalledTimes(1)
    expect(setItem.mock.calls.filter(([key]) => key === PINS_CHANGE_SIGNAL_KEY)).toHaveLength(1)
    expect(screen.getByTestId('pinned').textContent).toBe('["s1"]')
    setItem.mockRestore()
  })

  it('refetches ui-state on a cross-tab pins-changed storage event', async () => {
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    listSessions.mockClear()

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: PINS_CHANGE_SIGNAL_KEY }))
    })

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalled()
    })
  })

  it('refetches on the fallback interval when no daemon signal arrives', async () => {
    vi.useFakeTimers()

    try {
      await renderSettledOnFakeTimers()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSIONS_REFRESH_FALLBACK_MS)
      })

      expect(listSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('setWorkspaceColor with value calls patchGlobalUiState with set op', async () => {
    const user = await renderLoaded()

    await user.click(screen.getByTestId('set-color'))

    await waitFor(() => {
      expect(screen.getByTestId('color').textContent).toBe('#ff0000')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([
      { op: 'set', path: 'workspaceColor', value: '#ff0000' },
    ])
  })

  it('setWorkspaceColor with null calls patchGlobalUiState with unset op', async () => {
    const user = await renderLoadedAfterClick('set-color', 'color', '#ff0000')

    await user.click(screen.getByTestId('clear-color'))

    await waitFor(() => {
      expect(screen.getByTestId('color').textContent).toBe('none')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([{ op: 'unset', path: 'workspaceColor' }])
  })

  it('hydrates panelFilterPick from stored ui-state; panelFilter matches it with no fallback', async () => {
    getUiState.mockResolvedValue({ global: { pinnedSessions: [], sessionsPanelFilter: 'pinned' } })
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('panel-filter-pick').textContent).toBe('pinned')
    })
    expect(screen.getByTestId('panel-filter').textContent).toBe('pinned')
  })

  it('setFallbackToAll(true) makes panelFilter read All without touching the stored pick', async () => {
    const user = await renderLoaded()
    patchGlobalUiState.mockClear()

    await user.click(screen.getByTestId('fallback-on'))

    await waitFor(() => {
      expect(screen.getByTestId('panel-filter').textContent).toBe('all')
    })
    expect(screen.getByTestId('panel-filter-pick').textContent).toBe('conversations')
    expect(patchGlobalUiState).not.toHaveBeenCalled()
  })

  it('setPanelFilter clears a standing fallback and persists only the new pick', async () => {
    const user = await renderLoadedAfterClick('fallback-on', 'panel-filter', 'all')
    patchGlobalUiState.mockClear()

    await user.click(screen.getByTestId('pick-named'))

    await waitFor(() => {
      expect(screen.getByTestId('panel-filter').textContent).toBe('named')
    })
    expect(screen.getByTestId('panel-filter-pick').textContent).toBe('named')
    expect(patchGlobalUiState).toHaveBeenCalledWith([
      { op: 'set', path: 'sessionsPanelFilter', value: 'named' },
    ])
  })

  it('setFallbackToAll(false) returns panelFilter to the untouched pick', async () => {
    const user = await renderLoadedAfterClick('fallback-on', 'panel-filter', 'all')

    await user.click(screen.getByTestId('fallback-off'))

    await waitFor(() => {
      expect(screen.getByTestId('panel-filter').textContent).toBe('conversations')
    })
    expect(screen.getByTestId('panel-filter-pick').textContent).toBe('conversations')
  })

  it('sweeps dead-session storage keys after a successful fetch, leaving live ones alone', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1' }])
    localStorage.setItem('draft:s1', '{"current":"still here"}')
    localStorage.setItem('draft:long-gone', '{}')

    renderWithProvider()

    await waitFor(() => {
      expect(localStorage.getItem('draft:long-gone')).toBeNull()
    })
    expect(localStorage.getItem('draft:s1')).toBe('{"current":"still here"}')
  })

  it('does not sweep storage when the fetch fails', async () => {
    listSessions.mockRejectedValue(new Error('Network error'))
    localStorage.setItem('draft:orphan', '{}')

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Network error')
    })
    expect(localStorage.getItem('draft:orphan')).toBe('{}')
  })

  it('does not sweep a session that is live in another workspace', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }])
    listSessionsForWorkspace.mockResolvedValue({ sessions: [{ session_id: 'other-ws-session' }] })
    localStorage.setItem('draft:s1', '{"current":"still here"}')
    localStorage.setItem('draft:other-ws-session', '{"current":"alive in ws-2"}')
    localStorage.setItem('draft:truly-dead', '{}')

    renderWithProvider()

    await waitFor(() => {
      expect(localStorage.getItem('draft:truly-dead')).toBeNull()
    })
    expect(localStorage.getItem('draft:s1')).toBe('{"current":"still here"}')
    expect(localStorage.getItem('draft:other-ws-session')).toBe('{"current":"alive in ws-2"}')
  })

  it("keeps every draft when another workspace's listing fails", async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }, { id: 'ws-3' }])
    listSessionsForWorkspace.mockImplementation(id =>
      id === 'ws-2'
        ? Promise.reject(new Error('ws-2 unreachable'))
        : Promise.resolve({ sessions: [{ session_id: 'ws-3-session' }] }),
    )
    localStorage.setItem('draft:ws-2-session', '{"current":"unsent"}')
    localStorage.setItem('queue:ws-2-session', '["queued"]')
    localStorage.setItem('draft:truly-dead', '{}')

    renderWithProvider()

    await waitFor(() => {
      expect(listSessionsForWorkspace).toHaveBeenCalledTimes(2)
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(localStorage.getItem('draft:ws-2-session')).toBe('{"current":"unsent"}')
    expect(localStorage.getItem('queue:ws-2-session')).toBe('["queued"]')
    expect(localStorage.getItem('draft:truly-dead')).toBe('{}')
  })

  it('keeps every draft when the workspace list cannot be fetched', async () => {
    listWorkspaces.mockRejectedValue(new Error('daemon unreachable'))
    localStorage.setItem('draft:other-ws-session', '{"current":"unsent"}')

    renderWithProvider()

    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalledTimes(1)
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(localStorage.getItem('draft:other-ws-session')).toBe('{"current":"unsent"}')
  })

  it('a panel mounting while the first fetch is in flight joins it - one listing per load', async () => {
    const resolveMount = holdNextList()

    render(
      <SessionsProvider>
        <TestConsumer />
        <MountingPanel />
      </SessionsProvider>,
    )
    await act(async () => {
      resolveMount({ sessions: [{ session_id: 's1' }] })
    })

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(listSessions).toHaveBeenCalledTimes(1)
  })

  it('a reload within the sweep interval lists no other workspace', async () => {
    localStorage.setItem(SESSION_STORAGE_SWEEP_AT_KEY, String(Date.now()))
    listWorkspaces.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }])
    listSessionsForWorkspace.mockResolvedValue({ sessions: [] })

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(listWorkspaces).not.toHaveBeenCalled()
    expect(listSessionsForWorkspace).not.toHaveBeenCalled()
  })

  it("the sweep never holds up the list: other workspaces' listings run after it settles", async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }])
    listSessionsForWorkspace.mockReturnValue(new Promise(() => {}))

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('sessions').textContent).toBe('1')
  })

  it('a refetch returning the same sessions keeps the same list', async () => {
    const payload = () => ({
      sessions: [
        { session_id: 's1', num_turns: 2, failed_prompts: ['hi'] },
        { session_id: 's2', num_turns: 5, failed_prompts: null },
      ],
    })
    listSessions.mockImplementation(async () => payload())
    const result = await renderSessionsHook(2)
    const before = result.current.sessions

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.sessions).toBe(before)
  })

  it('a refetch changing one session keeps every other session object', async () => {
    let turns = 2
    listSessions.mockImplementation(async () => ({
      sessions: [
        { session_id: 's1', num_turns: turns },
        { session_id: 's2', num_turns: 5, failed_seeds: ['model'] },
      ],
    }))
    const result = await renderSessionsHook(2)
    const [s1Before, s2Before] = result.current.sessions

    turns = 3
    await act(async () => {
      await result.current.refresh()
    })

    const [s1After, s2After] = result.current.sessions
    expect(s1After).not.toBe(s1Before)
    expect(s1After.num_turns).toBe(3)
    expect(s2After).toBe(s2Before)
  })

  it('seeding a session with what it already holds keeps the same list', async () => {
    listSessions.mockResolvedValue({ sessions: [{ session_id: 's1', name: 'kept' }] })
    const result = await renderSessionsHook(1)
    const before = result.current.sessions

    act(() => {
      result.current.seedSession({ session_id: 's1', name: 'kept' })
    })

    expect(result.current.sessions).toBe(before)
  })

  it('coalesces two concurrent fetchSessions calls into one request', async () => {
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    listSessions.mockClear()

    // Two clicks in one tick - the second must join the first's in-flight promise. fireEvent, not
    // userEvent: its inter-event delay lets the first fetch settle before the second click.
    act(() => {
      fireEvent.click(screen.getByTestId('refresh'))
      fireEvent.click(screen.getByTestId('refresh'))
    })

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(1)
    })
  })

  it('does not re-run the cross-workspace sweep on a second fetch within the sweep interval', async () => {
    const user = await renderLoaded()
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    listWorkspaces.mockClear()
    listSessions.mockClear()

    await user.click(screen.getByTestId('refresh'))

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(1)
    })
    expect(listWorkspaces).not.toHaveBeenCalled()
  })

  it('defers an SSE-triggered refetch landing within the cooldown of a just-completed fetch to its end', async () => {
    vi.useFakeTimers()

    try {
      // Mount's own fetch stays in flight so the signal arrives before it settles.
      const resolveMount = holdNextList()

      const { rerender } = renderWithProvider()

      // Signal arrives immediately, arming a debounce timer that won't fire for SESSIONS_CHANGED_DEBOUNCE_MS.
      mockDaemonCtx.changesByWorkspace = { 'ws-1': 1 }
      await act(async () => {
        rerender(
          <SessionsProvider>
            <TestConsumer />
          </SessionsProvider>,
        )
      })

      // Mount's fetch settles partway through that window - well within it by the time the timer fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
        resolveMount({ sessions: [{ session_id: 's1' }] })
        await vi.advanceTimersByTimeAsync(0)
      })
      listSessions.mockClear()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSIONS_CHANGED_DEBOUNCE_MS - 500)
      })
      expect(listSessions).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(listSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still refetches an SSE signal that lands outside the debounce window', async () => {
    vi.useFakeTimers()

    try {
      // Age the completed-fetch timestamp well past the debounce window before the signal arrives.
      const { rerender } = await renderSettledOnFakeTimers(SESSIONS_CHANGED_DEBOUNCE_MS * 5)

      mockDaemonCtx.changesByWorkspace = { 'ws-1': 1 }
      await act(async () => {
        rerender(
          <SessionsProvider>
            <TestConsumer />
          </SessionsProvider>,
        )
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSIONS_CHANGED_DEBOUNCE_MS)
      })

      expect(listSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not refetch on another workspace's change", async () => {
    vi.useFakeTimers()

    try {
      const { rerender } = await renderSettledOnFakeTimers(SESSIONS_CHANGED_DEBOUNCE_MS * 5)

      // What the stream holds after one sessions_changed from another workspace.
      mockDaemonCtx.sessionsChanged = 1
      mockDaemonCtx.changesByWorkspace = { 'ws-2': 1 }
      await act(async () => {
        rerender(
          <SessionsProvider>
            <TestConsumer />
          </SessionsProvider>,
        )
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSIONS_CHANGED_DEBOUNCE_MS * 2)
      })

      expect(listSessions).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cross-tab pin-sync signal that lands mid-fetch still refetches once the in-flight request settles', async () => {
    const resolveMount = holdNextList()

    renderWithProvider()
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(1)
    })

    // The pin-sync signal joins the in-flight mount fetch rather than firing its own request.
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: PINS_CHANGE_SIGNAL_KEY, newValue: String(1) }),
      )
    })
    expect(listSessions).toHaveBeenCalledTimes(1)

    // Settling the mount fetch must trigger the deferred catch-up fetch for the missed signal.
    await act(async () => {
      resolveMount({ sessions: [{ session_id: 's1' }] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2)
    })
  })

  it('fetches independently for a new workspace even if the previous workspace is still in flight', async () => {
    let resolveFirst
    listSessions.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve
        }),
    )

    const { rerender } = renderWithProvider()
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(1)
    })

    mockWorkspaceCtx.workspaceId = 'ws-2'
    await act(async () => {
      rerender(
        <SessionsProvider>
          <TestConsumer />
        </SessionsProvider>,
      )
    })

    // Switching workspace must not silently join ws-1's still-pending promise.
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      resolveFirst({ sessions: [{ session_id: 'stale-ws1-session' }] })
      await Promise.resolve()
    })
  })

  it('refresh is never suppressed, even immediately after a fetch completes', async () => {
    const user = await renderLoaded()
    listSessions.mockClear()

    await user.click(screen.getByTestId('refresh'))

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(1)
    })
  })

  it('useSessionsList throws outside provider', () => {
    expect(() => render(<TestConsumer />)).toThrow(
      'useSessionsList must be used within SessionsProvider',
    )
  })
})

describe('a refresh read across local pin and color changes', () => {
  const wrapper = ({ children }) => <SessionsProvider>{children}</SessionsProvider>
  const stored = { global: { pinnedSessions: ['s2'], workspaceColor: null } }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockWorkspaceCtx.workspaceId = 'ws-1'
    mockDaemonCtx.sessionsChanged = 0
    mockDaemonCtx.changesByWorkspace = {}
    listSessions.mockResolvedValue({ sessions: [{ session_id: 's1' }, { session_id: 's2' }] })
    getUiState.mockResolvedValue(stored)
    listWorkspaces.mockRejectedValue(new Error('not registered in this test'))
    listSessionsForWorkspace.mockRejectedValue(new Error('not registered in this test'))
  })

  async function renderLoaded() {
    const view = renderHook(() => useSessionsList(), { wrapper })
    await waitFor(() => expect(view.result.current.pinnedSessions).toEqual(['s2']))
    return view
  }

  it('keeps pins and a color changed while the read was out, and still updates the sessions', async () => {
    const { result } = await renderLoaded()
    const read = createDeferred()
    getUiState.mockReturnValueOnce(read.promise)
    listSessions.mockResolvedValueOnce({
      sessions: [{ session_id: 's1' }, { session_id: 's2' }, { session_id: 's3' }],
    })

    let refreshed
    act(() => {
      refreshed = result.current.refresh()
    })
    act(() => {
      result.current.togglePin('s1')
      result.current.togglePin('s2')
      result.current.setWorkspaceColor('#ff0000')
    })
    await act(async () => {
      read.resolve(stored)
      await refreshed
    })

    expect(result.current.pinnedSessions).toEqual(['s1'])
    expect(result.current.workspaceColor).toBe('#ff0000')
    expect(result.current.sessions.map(s => s.session_id)).toEqual(['s1', 's2', 's3'])
  })

  it('keeps a pin and a color whose saves were still landing when the read went out', async () => {
    const { result } = await renderLoaded()
    const pinSave = createDeferred()
    const colorSave = createDeferred()
    patchGlobalUiState.mockReturnValueOnce(pinSave.promise).mockReturnValueOnce(colorSave.promise)

    act(() => {
      result.current.togglePin('s1')
      result.current.setWorkspaceColor('#00ff00')
    })
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.pinnedSessions).toEqual(['s2', 's1'])
    expect(result.current.workspaceColor).toBe('#00ff00')
    await act(async () => {
      pinSave.resolve()
      colorSave.resolve()
    })
  })

  it("takes another workspace's pins and color while a save in the first is still landing", async () => {
    const { result, rerender } = await renderLoaded()
    patchGlobalUiState.mockReturnValueOnce(createDeferred().promise)
    patchGlobalUiState.mockReturnValueOnce(createDeferred().promise)
    act(() => {
      result.current.togglePin('s1')
      result.current.setWorkspaceColor('#00ff00')
    })
    getUiState.mockResolvedValue({ global: { pinnedSessions: ['w2'], workspaceColor: '#222222' } })

    mockWorkspaceCtx.workspaceId = 'ws-2'
    rerender()

    await waitFor(() => expect(result.current.pinnedSessions).toEqual(['w2']))
    expect(result.current.workspaceColor).toBe('#222222')
  })

  it('takes pins and the color from a read sent after every save landed', async () => {
    const { result } = await renderLoaded()

    act(() => {
      result.current.togglePin('s1')
      result.current.setWorkspaceColor('#0000ff')
    })
    await act(async () => {})
    getUiState.mockResolvedValueOnce({
      global: { pinnedSessions: ['s2', 's1', 's9'], workspaceColor: '#123456' },
    })
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.pinnedSessions).toEqual(['s2', 's1', 's9'])
    expect(result.current.workspaceColor).toBe('#123456')
  })
})

describe('refresh joiner promise contract', () => {
  const wrapper = ({ children }) => <SessionsProvider>{children}</SessionsProvider>

  async function renderWithHeldLists() {
    const settlers = []
    listSessions.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settlers.push({ resolve, reject })
        }),
    )
    const hook = renderHook(() => useSessionsList(), { wrapper })
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(1)
    })

    return { ...hook, settlers }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockWorkspaceCtx.workspaceId = 'ws-1'
    mockDaemonCtx.sessionsChanged = 0
    mockDaemonCtx.changesByWorkspace = {}
    getUiState.mockResolvedValue({ global: { pinnedSessions: [], workspaceColor: null } })
    listWorkspaces.mockRejectedValue(new Error('not registered in this test'))
    listSessionsForWorkspace.mockRejectedValue(new Error('not registered in this test'))
  })

  it('does not resolve a joiner until the re-armed refetch settles', async () => {
    // Mount's own initial fetch is the request already in flight when the joiner below arrives.
    const { result, settlers } = await renderWithHeldLists()

    let joinerSettled = false
    const joiner = result.current.refresh().then(() => {
      joinerSettled = true
    })

    await act(async () => {
      settlers[0].resolve({ sessions: [{ session_id: 's1' }] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2)
    })

    // Mount's fetch settled and the re-arm issued a second request - the joiner must still be
    // waiting on that second request, not already resolved on the one it joined.
    expect(joinerSettled).toBe(false)

    await act(async () => {
      settlers[1].resolve({ sessions: [{ session_id: 's1' }, { session_id: 's2' }] })
      await joiner
    })

    expect(joinerSettled).toBe(true)
  })

  it('resolves a joiner with state no older than its own call', async () => {
    const { result, settlers } = await renderWithHeldLists()

    const joiner = result.current.refresh()

    await act(async () => {
      settlers[0].resolve({ sessions: [{ session_id: 's1' }] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      settlers[1].resolve({ sessions: [{ session_id: 's1' }, { session_id: 's2' }] })
      await joiner
    })

    // The joiner awaited state as of its own call, which the second (re-armed) response reflects.
    expect(result.current.sessions).toEqual([{ session_id: 's1' }, { session_id: 's2' }])
  })

  it('resolves an unjoined caller on its own request, with no extra round trip', async () => {
    listSessions.mockResolvedValue({ sessions: [{ session_id: 's1' }] })

    const { result } = renderHook(() => useSessionsList(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    listSessions.mockClear()

    await act(async () => {
      await result.current.refresh()
    })

    expect(listSessions).toHaveBeenCalledTimes(1)
  })

  it('waits for the re-armed refetch even when it errors, rather than settling on the joined one', async () => {
    const { result, settlers } = await renderWithHeldLists()

    let joinerSettled = false
    const joiner = result.current.refresh().finally(() => {
      joinerSettled = true
    })

    await act(async () => {
      settlers[0].resolve({ sessions: [{ session_id: 's1' }] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2)
    })

    // The first request succeeded, but the joiner must still be waiting on the re-armed second
    // one - even though that errors internally and fetchSessions records it without re-throwing.
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

  it('ignores a stale workspace response, keeps the new workspace bookkeeping intact, and settles cleanly on its own response', async () => {
    const { result, rerender, settlers } = await renderWithHeldLists()

    mockWorkspaceCtx.workspaceId = 'ws-2'
    act(() => {
      rerender()
    })
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2)
    })

    // ws-1's stale response settles after ws-2's own request has already started.
    await act(async () => {
      settlers[0].resolve({ sessions: [{ session_id: 'stale-ws1-session' }] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // Never painted: ws-2's request is still pending.
    expect(result.current.sessions).toEqual([])

    // ws-2's bookkeeping survived ws-1's late finally - a fresh call while ws-2's request is
    // still in flight joins it rather than firing a third, unsolicited fetch.
    act(() => {
      result.current.refresh()
    })
    expect(listSessions).toHaveBeenCalledTimes(2)

    // ws-2's own response settles cleanly, unaffected by ws-1's stale bookkeeping.
    await act(async () => {
      settlers[1].resolve({ sessions: [{ session_id: 'ws2-session' }] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(result.current.sessions).toEqual([{ session_id: 'ws2-session' }])
    expect(result.current.loading).toBe(false)
  })

  it('settles an orphaned joiner when its workspace is switched away, without a spurious extra fetch', async () => {
    // Mount's own initial fetch (for ws-1) is the request already in flight when the joiner
    // below arrives.
    const { result, rerender, settlers } = await renderWithHeldLists()

    let joinerSettled = false
    act(() => {
      result.current.refresh().then(() => {
        joinerSettled = true
      })
    })

    // Workspace switch: the next request cannot join mount's in-flight ws-1 one, so it must
    // settle that orphaned joiner immediately rather than carry it into ws-2's settle.
    mockWorkspaceCtx.workspaceId = 'ws-2'
    act(() => {
      rerender()
    })

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2)
    })

    expect(joinerSettled).toBe(true)

    // Mount's ws-1 request settling late, with ownership already lost, must not add a third,
    // unsolicited call.
    await act(async () => {
      settlers[0].resolve({ sessions: [{ session_id: 's1' }] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(listSessions).toHaveBeenCalledTimes(2)
  })
})
