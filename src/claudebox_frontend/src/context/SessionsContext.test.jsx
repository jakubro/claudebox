/** Tests for SessionsContext. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PINS_CHANGE_SIGNAL_KEY } from '../config/storage'
import { SESSIONS_CHANGED_DEBOUNCE_MS, SESSIONS_REFRESH_FALLBACK_MS } from '../config/timing'

const mockWorkspaceCtx = { workspaceId: 'ws-1' }
vi.mock('./WorkspaceContext', () => ({ useWorkspace: () => mockWorkspaceCtx }))

const mockDaemonCtx = { sessionsChanged: 0, containerStatus: 0 }
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
    </div>
  )
}

function renderWithProvider() {
  return render(
    <SessionsProvider>
      <TestConsumer />
    </SessionsProvider>,
  )
}

describe('SessionsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockWorkspaceCtx.workspaceId = 'ws-1'
    mockDaemonCtx.sessionsChanged = 0
    mockDaemonCtx.containerStatus = 0
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
    const user = userEvent.setup()
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await user.click(screen.getByTestId('pin'))

    await waitFor(() => {
      expect(screen.getByTestId('pinned').textContent).toBe('["s1"]')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([
      { op: 'add', path: 'pinnedSessions', value: 's1' },
    ])
  })

  it('togglePin removes sessionId from pinned list when already pinned', async () => {
    const user = userEvent.setup()
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await user.click(screen.getByTestId('pin'))
    await waitFor(() => {
      expect(screen.getByTestId('pinned').textContent).toBe('["s1"]')
    })

    await user.click(screen.getByTestId('pin'))
    await waitFor(() => {
      expect(screen.getByTestId('pinned').textContent).toBe('[]')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([
      { op: 'remove', path: 'pinnedSessions', value: 's1' },
    ])
  })

  it('togglePin signals other tabs via the pins-changed storage key', async () => {
    const user = userEvent.setup()
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await user.click(screen.getByTestId('pin'))

    expect(setItem).toHaveBeenCalledWith(PINS_CHANGE_SIGNAL_KEY, expect.any(String))
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
      renderWithProvider()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      listSessions.mockClear()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSIONS_REFRESH_FALLBACK_MS)
      })

      expect(listSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('setWorkspaceColor with value calls patchGlobalUiState with set op', async () => {
    const user = userEvent.setup()
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await user.click(screen.getByTestId('set-color'))

    await waitFor(() => {
      expect(screen.getByTestId('color').textContent).toBe('#ff0000')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([
      { op: 'set', path: 'workspaceColor', value: '#ff0000' },
    ])
  })

  it('setWorkspaceColor with null calls patchGlobalUiState with unset op', async () => {
    const user = userEvent.setup()
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await user.click(screen.getByTestId('set-color'))
    await waitFor(() => {
      expect(screen.getByTestId('color').textContent).toBe('#ff0000')
    })

    await user.click(screen.getByTestId('clear-color'))

    await waitFor(() => {
      expect(screen.getByTestId('color').textContent).toBe('none')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([{ op: 'unset', path: 'workspaceColor' }])
  })

  it('sweeps dead-session storage keys after a successful fetch, leaving live ones alone', async () => {
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
    const user = userEvent.setup()
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    listWorkspaces.mockClear()
    listSessions.mockClear()

    await user.click(screen.getByTestId('refresh'))

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(1)
    })
    expect(listWorkspaces).not.toHaveBeenCalled()
  })

  it('drops an SSE-triggered refetch that lands within the debounce window of a just-completed fetch', async () => {
    vi.useFakeTimers()

    try {
      // Mount's own fetch stays in flight so the signal arrives before it settles.
      let resolveMount
      listSessions.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveMount = resolve
          }),
      )

      const { rerender } = renderWithProvider()

      // Signal arrives immediately, arming a debounce timer that won't fire for SESSIONS_CHANGED_DEBOUNCE_MS.
      mockDaemonCtx.sessionsChanged = 1
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
    } finally {
      vi.useRealTimers()
    }
  })

  it('still refetches an SSE signal that lands outside the debounce window', async () => {
    vi.useFakeTimers()

    try {
      const { rerender } = renderWithProvider()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      // Age the completed-fetch timestamp well past the debounce window before the signal arrives.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSIONS_CHANGED_DEBOUNCE_MS * 5)
      })
      listSessions.mockClear()

      mockDaemonCtx.sessionsChanged = 1
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

  it('a cross-tab pin-sync signal that lands mid-fetch still refetches once the in-flight request settles', async () => {
    let resolveMount
    listSessions.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveMount = resolve
        }),
    )

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
    const user = userEvent.setup()
    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
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
