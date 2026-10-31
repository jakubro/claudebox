/** Tests for useDockviewLayout - focused on maximize snapshot and cleanup. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { restoreFromServer } = vi.hoisted(() => ({ restoreFromServer: vi.fn() }))

vi.mock('../../../api/uiState', () => ({
  patchSessionUiState: vi.fn(),
}))

vi.mock('../../../constants/timing', () => ({
  LAYOUT_SAVE_DEBOUNCE_MS: 100,
}))

vi.mock('../../../managers/SidePanelManager', () => ({
  default: class MockSidePanelManager {
    state = { left: { order: [] }, right: { order: [] } }
    preMaximizeLayout = null
    restoreFromServer = restoreFromServer
    toggle = vi.fn()
    close = vi.fn()
    handlePanelMove = vi.fn()
    updateDimensions = vi.fn()
    maximizeToggle = vi.fn()
    fromJSON = vi.fn()
    toJSON = vi.fn().mockReturnValue({ panels: {} })
  },
}))

vi.mock('../layout-config', () => ({
  SIDE_PANEL_CONFIG: {},
}))

vi.mock('../utils/default-layout', () => ({
  applyMainGroupMarker: vi.fn(),
  buildDefaultLayout: vi.fn(),
}))

vi.mock('../../../utils/layoutPersistence', () => ({
  buildSaveOps: vi.fn().mockReturnValue([]),
}))

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'test-workspace' }),
}))

import { patchSessionUiState } from '../../../api/uiState'
import { LAYOUT_RESTORE_GRACE_MS, LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'
import { buildDefaultLayout } from '../utils/default-layout'
import useDockviewLayout from './useDockviewLayout'

describe('useDockviewLayout', () => {
  let rafCallbacks

  beforeEach(() => {
    restoreFromServer.mockReset().mockResolvedValue({ loaded: false })
    buildDefaultLayout.mockClear()
    vi.useFakeTimers()
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function _flushRAF() {
    const cbs = rafCallbacks.splice(0)
    for (const cb of cbs) {
      cb()
    }
  }

  function createMockApi(overrides = {}) {
    return {
      toJSON: vi.fn().mockReturnValue({ panels: [], groups: [] }),
      fromJSON: vi.fn(),
      clear: vi.fn(),
      panels: [{}],
      groups: [],
      onDidAddGroup: vi.fn(),
      onDidMovePanel: vi.fn(),
      onDidLayoutChange: vi.fn(),
      onDidMaximizedGroupChange: vi.fn(),
      hasMaximizedGroup: vi.fn().mockReturnValue(false),
      exitMaximizedGroup: vi.fn(),
      ...overrides,
    }
  }

  async function renderReady(mockApi) {
    const hook = renderHook(() => useDockviewLayout())
    await act(async () => {
      hook.result.current.onReady({ api: mockApi })
    })

    return hook
  }

  describe('handleMaximizeToggle', () => {
    it('delegates to SidePanelManager.maximizeToggle', async () => {
      const { result } = renderHook(() => useDockviewLayout())
      const mockApi = createMockApi()

      await act(async () => {
        result.current.onReady({ api: mockApi })
      })

      const groupApi = { isMaximized: () => false, maximize: vi.fn() }
      act(() => {
        result.current.handleMaximizeToggle(groupApi)
      })

      // Hook delegates to manager - maximize is NOT called directly by the hook
      expect(groupApi.maximize).not.toHaveBeenCalled()
    })

    it('does nothing when manager is null', () => {
      const { result } = renderHook(() => useDockviewLayout())

      // No onReady called, so manager is null
      const groupApi = { isMaximized: () => false, maximize: vi.fn() }
      act(() => {
        result.current.handleMaximizeToggle(groupApi)
      })

      expect(groupApi.maximize).not.toHaveBeenCalled()
    })
  })

  describe('isMaximized via onDidMaximizedGroupChange', () => {
    it('updates isMaximized when maximize event fires', async () => {
      let maximizeCallback
      const mockApi = createMockApi({
        onDidMaximizedGroupChange: vi.fn(cb => {
          maximizeCallback = cb
        }),
      })

      const { result } = await renderReady(mockApi)

      expect(result.current.isMaximized).toBe(false)

      mockApi.hasMaximizedGroup.mockReturnValue(true)
      act(() => {
        maximizeCallback()
      })

      expect(result.current.isMaximized).toBe(true)

      mockApi.hasMaximizedGroup.mockReturnValue(false)
      act(() => {
        maximizeCallback()
      })

      expect(result.current.isMaximized).toBe(false)
    })
  })

  describe('rebuild guard on failed restore', () => {
    it('onReady clears and rebuilds even when a failed restore left panels behind', async () => {
      // Panels can survive a partial fromJSON failure despite `loaded: false` - rebuild anyway.
      const mockApi = createMockApi({ panels: [{ id: 'main' }, { id: 'sessions' }] })
      await renderReady(mockApi)

      expect(mockApi.clear).toHaveBeenCalled()
      expect(buildDefaultLayout).toHaveBeenCalled()
    })

    it('onSessionAttach leaves the layout alone when the session has no restore of its own', async () => {
      const mockApi = createMockApi({ panels: [{ id: 'main' }, { id: 'sessions' }] })
      const { result } = await renderReady(mockApi)
      mockApi.clear.mockClear()
      buildDefaultLayout.mockClear()

      await act(async () => {
        await result.current.onSessionAttach('session-1')
      })

      expect(mockApi.clear).not.toHaveBeenCalled()
      expect(buildDefaultLayout).not.toHaveBeenCalled()
    })
  })

  describe('a layout change that settles before the session attaches', () => {
    async function settledBeforeAttach() {
      const mockApi = createMockApi()
      const { result } = await renderReady(mockApi)
      patchSessionUiState.mockClear()
      const [onLayoutChange] = mockApi.onDidLayoutChange.mock.calls[0]

      act(() => {
        onLayoutChange()
        vi.advanceTimersByTime(LAYOUT_SAVE_DEBOUNCE_MS)
      })

      return result
    }

    it('is saved once the session attaches', async () => {
      const result = await settledBeforeAttach()
      expect(patchSessionUiState).not.toHaveBeenCalled()

      await act(async () => {
        await result.current.onSessionAttach('session-1')
      })

      expect(patchSessionUiState).toHaveBeenCalledTimes(1)
      expect(patchSessionUiState.mock.calls[0][0]).toBe('session-1')
    })

    it('is saved once, not again when a second session attaches', async () => {
      const result = await settledBeforeAttach()

      await act(async () => {
        await result.current.onSessionAttach('session-1')
        await result.current.onSessionAttach('session-2')
      })

      expect(patchSessionUiState).toHaveBeenCalledTimes(1)
    })
  })

  describe('a session that attaches before the layout is ready', () => {
    it('is the target of the layout saves that follow', async () => {
      const mockApi = createMockApi()
      const { result } = renderHook(() => useDockviewLayout())
      await act(async () => {
        await result.current.onSessionAttach('session-1')
        result.current.onReady({ api: mockApi })
      })
      patchSessionUiState.mockClear()
      const [onLayoutChange] = mockApi.onDidLayoutChange.mock.calls[0]

      act(() => {
        onLayoutChange()
        vi.advanceTimersByTime(LAYOUT_SAVE_DEBOUNCE_MS)
      })

      expect(patchSessionUiState).toHaveBeenCalledTimes(1)
      expect(patchSessionUiState.mock.calls[0][0]).toBe('session-1')
    })
  })

  describe('initial layout on a session URL', () => {
    afterEach(() => {
      window.location.hash = ''
    })

    it('applies the session layout without building the default first, and never re-applies it', async () => {
      window.location.hash = '#/workspaces/ws-1/sessions/session-1'
      restoreFromServer.mockImplementation(async id => ({ loaded: id === 'session-1' }))
      const { result } = renderHook(() => useDockviewLayout())

      await act(async () => {
        result.current.onReady({ api: createMockApi() })
      })
      await act(async () => {
        await result.current.onSessionAttach('session-1')
      })

      expect(restoreFromServer.mock.calls).toEqual([['session-1']])
      expect(buildDefaultLayout).not.toHaveBeenCalled()
    })

    it('falls back to the inherited layout when the session saved none', async () => {
      window.location.hash = '#/workspaces/ws-1/sessions/session-1'
      restoreFromServer.mockImplementation(async id => ({ loaded: id === null }))
      const { result } = renderHook(() => useDockviewLayout())

      await act(async () => {
        result.current.onReady({ api: createMockApi() })
      })
      await act(async () => {
        await result.current.onSessionAttach('session-1')
      })

      expect(restoreFromServer.mock.calls).toEqual([['session-1'], [null]])
      expect(buildDefaultLayout).not.toHaveBeenCalled()
    })
  })

  describe('a saved layout that is slow to arrive', () => {
    it('builds the default meanwhile, then applies the saved layout over it', async () => {
      let resolveRestore
      restoreFromServer.mockReturnValue(
        new Promise(resolve => {
          resolveRestore = resolve
        }),
      )
      const mockApi = createMockApi()
      await renderReady(mockApi)
      expect(buildDefaultLayout).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(LAYOUT_RESTORE_GRACE_MS)
      })
      expect(buildDefaultLayout).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveRestore({ loaded: true })
      })
      expect(buildDefaultLayout).toHaveBeenCalledTimes(1)
      expect(mockApi.clear).not.toHaveBeenCalled()
    })

    it('keeps the default it built meanwhile when no saved layout exists', async () => {
      let resolveRestore
      restoreFromServer.mockReturnValue(
        new Promise(resolve => {
          resolveRestore = resolve
        }),
      )
      const mockApi = createMockApi({ getPanel: vi.fn(id => (id === 'main' ? { id } : undefined)) })
      await renderReady(mockApi)
      await act(async () => {
        vi.advanceTimersByTime(LAYOUT_RESTORE_GRACE_MS)
      })
      await act(async () => {
        resolveRestore({ loaded: false })
      })

      expect(buildDefaultLayout).toHaveBeenCalledTimes(1)
      expect(mockApi.clear).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('cleanup effect runs on unmount', () => {
      const { unmount } = renderHook(() => useDockviewLayout())

      // Unmount should not throw (cleanup effect clears timeout ref)
      expect(() => unmount()).not.toThrow()
    })
  })
})
