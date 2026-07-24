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

vi.mock('../api/sessions', () => ({ listSessions: vi.fn() }))
vi.mock('../api/uiState', () => ({ getUiState: vi.fn(), patchGlobalUiState: vi.fn() }))

import { listSessions } from '../api/sessions'
import { getUiState, patchGlobalUiState } from '../api/uiState'
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
    mockWorkspaceCtx.workspaceId = 'ws-1'
    mockDaemonCtx.sessionsChanged = 0
    mockDaemonCtx.containerStatus = 0
    listSessions.mockResolvedValue({ sessions: [{ session_id: 's1' }] })
    getUiState.mockResolvedValue({ global: { pinnedSessions: [], workspaceColor: null } })
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

    // Pin first
    await user.click(screen.getByTestId('pin'))
    await waitFor(() => {
      expect(screen.getByTestId('pinned').textContent).toBe('["s1"]')
    })

    // Unpin
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

    // Set a color first
    await user.click(screen.getByTestId('set-color'))
    await waitFor(() => {
      expect(screen.getByTestId('color').textContent).toBe('#ff0000')
    })

    // Clear it
    await user.click(screen.getByTestId('clear-color'))

    await waitFor(() => {
      expect(screen.getByTestId('color').textContent).toBe('none')
    })
    expect(patchGlobalUiState).toHaveBeenCalledWith([{ op: 'unset', path: 'workspaceColor' }])
  })

  it('useSessionsList throws outside provider', () => {
    expect(() => render(<TestConsumer />)).toThrow(
      'useSessionsList must be used within SessionsProvider',
    )
  })
})
