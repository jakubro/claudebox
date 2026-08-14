/** Tests for SessionsContext. */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PINS_CHANGE_SIGNAL_KEY } from '../config/storage'
import { SESSIONS_REFRESH_FALLBACK_MS } from '../config/timing'

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

  it('useSessionsList throws outside provider', () => {
    expect(() => render(<TestConsumer />)).toThrow(
      'useSessionsList must be used within SessionsProvider',
    )
  })
})
