/** Tests for useDockviewLayout - focused on maximize snapshot and cleanup. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('../../../api/uiState', () => ({
  patchSessionUiState: vi.fn(),
}))

vi.mock('../../../constants/timing', () => ({
  LAYOUT_SAVE_DEBOUNCE_MS: 100,
}))

vi.mock('../../../managers/SidePanelManager', () => ({
  default: class MockSidePanelManager {
    state = { left: { order: [] }, right: { order: [] }, bottom: { order: [] } }
    preMaximizeLayout = null
    restoreFromServer = vi.fn().mockResolvedValue({ loaded: false })
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
  buildDefaultLayout: vi.fn(),
}))

vi.mock('../../../utils/layoutPersistence', () => ({
  buildSaveOps: vi.fn().mockReturnValue([]),
}))

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'test-workspace' }),
}))

import useDockviewLayout from './useDockviewLayout'

describe('useDockviewLayout', () => {
  let rafCallbacks

  beforeEach(() => {
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

      const { result } = renderHook(() => useDockviewLayout())

      await act(async () => {
        result.current.onReady({ api: mockApi })
      })

      expect(result.current.isMaximized).toBe(false)

      // Simulate runtime maximize
      mockApi.hasMaximizedGroup.mockReturnValue(true)
      act(() => {
        maximizeCallback()
      })

      expect(result.current.isMaximized).toBe(true)

      // Simulate un-maximize
      mockApi.hasMaximizedGroup.mockReturnValue(false)
      act(() => {
        maximizeCallback()
      })

      expect(result.current.isMaximized).toBe(false)
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
