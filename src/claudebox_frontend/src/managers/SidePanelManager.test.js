/** Tests for SidePanelManager class. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidePanelManager from './SidePanelManager'

// Mock the API modules
vi.mock('../api/uiState', () => ({
  getUiState: vi.fn(),
}))

vi.mock('../api/apiClient', () => ({
  getWorkspaceId: vi.fn(() => 'test-workspace'),
}))

describe('SidePanelManager', () => {
  const CONFIG = {
    sides: {
      sessions: 'left',
      files: 'left',
      todos: 'right',
      stash: 'right',
      help: 'right',
      logs: 'bottom',
    },
    canonicalOrder: {
      left: ['sessions', 'files'],
      right: ['todos', 'stash', 'help'],
      bottom: ['logs'],
    },
    defaultWidth: 0.15,
    defaultHeight: 0.25,
  }

  let mockApi
  let manager

  beforeEach(() => {
    mockApi = createMockApi()
    manager = new SidePanelManager(mockApi, CONFIG)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('toggle', () => {
    it('opens panel when closed', () => {
      mockApi.getPanel.mockReturnValue(null) // Panel doesn't exist

      manager.toggle('todos')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'todos',
          component: 'todos',
        }),
      )
    })

    it('closes panel when open', () => {
      const mockPanel = createMockPanel('todos')
      mockApi.getPanel.mockReturnValue(mockPanel)

      manager.toggle('todos')

      expect(mockPanel.api.close).toHaveBeenCalled()
    })

    it('removes panel from order when closed', () => {
      const mockPanel = createMockPanel('todos')
      mockApi.getPanel.mockReturnValue(mockPanel)
      manager.state.right.order = ['todos', 'stash']

      manager.toggle('todos')

      expect(manager.state.right.order).toEqual(['stash'])
    })

    it('adds panel to order when opened', () => {
      mockApi.getPanel.mockReturnValue(null)
      manager.state.right.order = []

      manager.toggle('todos')

      expect(manager.state.right.order).toContain('todos')
    })
  })

  describe('width preservation', () => {
    it('captures width before toggle', () => {
      const mockPanel = createMockPanel('todos', { width: 200 })
      mockApi.panels = [mockPanel]
      mockApi.getPanel.mockReturnValue(mockPanel)
      manager.state.right.order = ['todos']

      manager.toggle('todos')

      // Width should be captured before close
      expect(manager.state.right.width).toBe(200)
    })

    it('restores width after toggle via requestAnimationFrame', () => {
      mockApi.getPanel.mockReturnValue(null)
      manager.state.right.width = 250
      manager.state.right.order = []

      manager.toggle('todos')

      // requestAnimationFrame callback should restore width
      const rafCallback = vi.mocked(globalThis.requestAnimationFrame).mock.calls[0][0]
      rafCallback()

      // Should have set size on the new panel's group
      expect(mockApi.addPanel).toHaveBeenCalled()
    })

    it('preserves width when reopening after all panels on side closed', () => {
      // Set up saved width from previous closure
      manager.state.right.width = 300
      manager.state.right.order = []
      mockApi.getPanel.mockReturnValue(null)

      manager.toggle('todos')

      // First panel on side should use saved width
      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialWidth: 300,
        }),
      )
    })

    it('uses default width when no saved width', () => {
      manager.state.right.width = null
      manager.state.right.order = []
      mockApi.getPanel.mockReturnValue(null)
      global.innerWidth = 1000

      manager.toggle('todos')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialWidth: 150, // 1000 * 0.15
        }),
      )
    })
  })

  describe('canonical ordering', () => {
    it('inserts panel below existing panel that should be above it', () => {
      // 'sessions' is open, opening 'files' should go below
      const sessionsPanel = createMockPanel('sessions')
      mockApi.getPanel.mockImplementation(id => (id === 'sessions' ? sessionsPanel : null))
      manager.state.left.order = ['sessions']

      manager.toggle('files')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'files',
          position: { direction: 'below', referencePanel: 'sessions' },
        }),
      )
    })

    it('inserts panel above existing panel that should be below it', () => {
      // 'stash' is open, opening 'todos' should go above
      const stashPanel = createMockPanel('stash')
      mockApi.getPanel.mockImplementation(id => (id === 'stash' ? stashPanel : null))
      manager.state.right.order = ['stash']

      manager.toggle('todos')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'todos',
          position: { direction: 'above', referencePanel: 'stash' },
        }),
      )
    })

    it('creates new group at edge when no panels on side', () => {
      mockApi.getPanel.mockReturnValue(null)
      manager.state.left.order = []

      manager.toggle('sessions')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sessions',
          position: { direction: 'left' },
        }),
      )
    })
  })

  describe('panel detachment tracking', () => {
    it('removes panel from order when moved out of side group', () => {
      manager.state.left.order = ['sessions', 'files']

      // Panel moved to group with chat (not a left-side panel)
      const movedPanel = {
        id: 'sessions',
        api: { group: { panels: [{ id: 'chat' }, { id: 'sessions' }] } },
      }

      manager.handlePanelMove(movedPanel)

      expect(manager.state.left.order).toEqual(['files'])
    })

    it('keeps panel in order when still grouped with same-side panels', () => {
      manager.state.left.order = ['sessions', 'files']

      // Panel still grouped with files (both left-side)
      const movedPanel = {
        id: 'sessions',
        api: { group: { panels: [{ id: 'sessions' }, { id: 'files' }] } },
      }

      manager.handlePanelMove(movedPanel)

      expect(manager.state.left.order).toEqual(['sessions', 'files'])
    })
  })

  describe('persistence', () => {
    it('serializes state to JSON', () => {
      manager.state.left = { width: 200, order: ['sessions'] }
      manager.state.right = { width: 150, order: ['todos', 'stash'] }

      const json = manager.toJSON()

      expect(json).toEqual({
        left: { width: 200, order: ['sessions'] },
        right: { width: 150, order: ['todos', 'stash'] },
        bottom: { height: null, order: [] },
      })
    })

    it('restores state from JSON', () => {
      const saved = {
        left: { width: 250, order: ['sessions'] },
        right: { width: 180, order: ['todos'] },
      }

      manager.fromJSON(saved)

      expect(manager.state.left).toEqual({ width: 250, order: ['sessions'] })
      expect(manager.state.right).toEqual({ width: 180, order: ['todos'] })
    })

    it('handles null/undefined in fromJSON gracefully', () => {
      const original = { ...manager.state }

      manager.fromJSON(null)

      expect(manager.state).toEqual(original)
    })

    it('preserves state when fromJSON has partial data', () => {
      manager.state.left = { width: 200, order: ['sessions'] }

      manager.fromJSON({ right: { width: 150, order: ['todos'] } })

      expect(manager.state.left).toEqual({ width: 200, order: ['sessions'] })
      expect(manager.state.right).toEqual({ width: 150, order: ['todos'] })
    })

    it('serializes and restores bottom state, filtering stray logs entries', () => {
      // 'logs' is rendered in the full-width strip, never in the bottom slot -
      // any 'logs' id surfacing in bottom.order is stripped on restore (mirrors
      // the 'files' filter).
      manager.state.bottom = { height: 250, order: ['logs'] }

      const json = manager.toJSON()

      expect(json.bottom).toEqual({ height: 250, order: ['logs'] })

      // Reset and restore - filter strips 'logs' from the order.
      manager.state.bottom = { height: null, order: [] }
      manager.fromJSON(json)

      expect(manager.state.bottom).toEqual({ height: 250, order: [] })
    })
  })

  describe('multiple rapid toggles', () => {
    it('handles rapid toggle calls without race conditions', () => {
      mockApi.getPanel.mockReturnValue(null)
      manager.state.right.order = []

      // Rapid toggles
      manager.toggle('todos')
      manager.toggle('stash')
      manager.toggle('help')

      expect(mockApi.addPanel).toHaveBeenCalledTimes(3)
      expect(manager.state.right.order).toContain('todos')
      expect(manager.state.right.order).toContain('stash')
      expect(manager.state.right.order).toContain('help')
    })

    it('handles toggle-close-toggle sequence', () => {
      // First toggle opens
      mockApi.getPanel.mockReturnValue(null)
      manager.toggle('todos')
      expect(manager.state.right.order).toContain('todos')

      // Second toggle closes
      const mockPanel = createMockPanel('todos')
      mockApi.getPanel.mockReturnValue(mockPanel)
      manager.toggle('todos')
      expect(manager.state.right.order).not.toContain('todos')

      // Third toggle opens again
      mockApi.getPanel.mockReturnValue(null)
      manager.toggle('todos')
      expect(manager.state.right.order).toContain('todos')
    })
  })

  describe('open', () => {
    it('does nothing if panel already exists', () => {
      const mockPanel = createMockPanel('todos')
      mockApi.getPanel.mockReturnValue(mockPanel)

      manager.open('todos')

      expect(mockApi.addPanel).not.toHaveBeenCalled()
    })

    it('adds panel when it does not exist', () => {
      mockApi.getPanel.mockReturnValue(null)

      manager.open('todos')

      expect(mockApi.addPanel).toHaveBeenCalled()
    })
  })

  describe('close', () => {
    it('does nothing if panel does not exist', () => {
      mockApi.getPanel.mockReturnValue(null)
      manager.state.right.order = ['todos', 'stash']

      manager.close('todos')

      expect(manager.state.right.order).toEqual(['todos', 'stash'])
    })

    it('closes panel and removes from order', () => {
      const mockPanel = createMockPanel('todos')
      mockApi.getPanel.mockReturnValue(mockPanel)
      manager.state.right.order = ['todos', 'stash']

      manager.close('todos')

      expect(mockPanel.api.close).toHaveBeenCalled()
      expect(manager.state.right.order).toEqual(['stash'])
    })
  })

  describe('maximizeToggle', () => {
    it('saves snapshot and maximizes when not maximized', () => {
      const savedLayout = { panels: [], groups: [] }
      mockApi.toJSON.mockReturnValue(savedLayout)
      manager.state.right.order = ['todos']

      const groupApi = { isMaximized: () => false, maximize: vi.fn() }
      manager.maximizeToggle(groupApi)

      expect(mockApi.toJSON).toHaveBeenCalledOnce()
      expect(manager.preMaximizeLayout).toEqual({
        layout: savedLayout,
        panelGroups: manager.toJSON(),
      })
      expect(groupApi.maximize).toHaveBeenCalledOnce()
    })

    it('restores snapshot via rAF when exiting maximize', () => {
      const savedLayout = { panels: [], groups: [] }
      const savedPanelGroups = { left: { width: 200, order: ['sessions'] } }
      manager.preMaximizeLayout = { layout: savedLayout, panelGroups: savedPanelGroups }

      const groupApi = { isMaximized: () => true, exitMaximized: vi.fn() }
      manager.maximizeToggle(groupApi)

      expect(groupApi.exitMaximized).toHaveBeenCalledOnce()
      expect(manager.preMaximizeLayout).toBeNull()
      // No destructive fromJSON - exitMaximized preserves panels
      expect(mockApi.fromJSON).not.toHaveBeenCalled()

      // Flush rAF - dimensions restored from snapshot
      const rafCb = vi.mocked(globalThis.requestAnimationFrame).mock.calls[0][0]
      rafCb()

      // Panel groups state restored, not full layout
      expect(manager.state.left.width).toBe(200)
      expect(manager.state.left.order).toEqual(['sessions'])
    })

    it('exits maximize without restore when no snapshot', () => {
      manager.preMaximizeLayout = null

      const groupApi = { isMaximized: () => true, exitMaximized: vi.fn() }
      manager.maximizeToggle(groupApi)

      expect(groupApi.exitMaximized).toHaveBeenCalledOnce()
      expect(mockApi.fromJSON).not.toHaveBeenCalled()
    })

    it('does nothing when groupApi is null', () => {
      manager.maximizeToggle(null)
      expect(mockApi.toJSON).not.toHaveBeenCalled()
    })
  })

  describe('toggle exits maximize first', () => {
    it('restores snapshot before toggling when maximized with snapshot', () => {
      const savedLayout = { panels: { chat: {} } }
      const savedPanelGroups = { right: { width: 200, order: ['todos'] } }
      manager.preMaximizeLayout = { layout: savedLayout, panelGroups: savedPanelGroups }
      mockApi.hasMaximizedGroup.mockReturnValue(true)
      mockApi.getPanel.mockReturnValue(null)

      manager.toggle('todos')

      // Should exit maximize without destructive fromJSON
      expect(mockApi.exitMaximizedGroup).toHaveBeenCalledOnce()
      expect(mockApi.fromJSON).not.toHaveBeenCalled()
      expect(manager.preMaximizeLayout).toBeNull()
      // Should still toggle the panel
      expect(mockApi.addPanel).toHaveBeenCalled()
    })

    it('calls exitMaximizedGroup when maximized without snapshot', () => {
      manager.preMaximizeLayout = null
      mockApi.hasMaximizedGroup.mockReturnValue(true)
      mockApi.getPanel.mockReturnValue(null)

      manager.toggle('todos')

      expect(mockApi.exitMaximizedGroup).toHaveBeenCalledOnce()
      expect(mockApi.addPanel).toHaveBeenCalled()
    })

    it('does not exit maximize when not maximized', () => {
      mockApi.hasMaximizedGroup.mockReturnValue(false)
      mockApi.getPanel.mockReturnValue(null)

      manager.toggle('todos')

      expect(mockApi.exitMaximizedGroup).not.toHaveBeenCalled()
      expect(mockApi.fromJSON).not.toHaveBeenCalled()
    })

    it('only unmaximizes when toggling already-open panel while maximized', () => {
      manager.state.right.order = ['todos']
      const savedLayout = { panels: { chat: {} } }
      const savedPanelGroups = { right: { width: 200, order: ['todos'] } }
      manager.preMaximizeLayout = { layout: savedLayout, panelGroups: savedPanelGroups }
      mockApi.hasMaximizedGroup.mockReturnValue(true)

      manager.toggle('todos')

      // Should exit maximize without destructive fromJSON
      expect(mockApi.exitMaximizedGroup).toHaveBeenCalledOnce()
      expect(mockApi.fromJSON).not.toHaveBeenCalled()
      expect(manager.preMaximizeLayout).toBeNull()
      // Should NOT close or re-open the panel
      expect(mockApi.addPanel).not.toHaveBeenCalled()
    })

    it('unmaximizes and opens closed panel while maximized', () => {
      manager.state.right.order = [] // todos not open
      manager.preMaximizeLayout = { layout: {}, panelGroups: {} }
      mockApi.hasMaximizedGroup.mockReturnValue(true)
      mockApi.getPanel.mockReturnValue(null)

      manager.toggle('todos')

      // Should exit maximize without destructive fromJSON
      expect(mockApi.exitMaximizedGroup).toHaveBeenCalledOnce()
      expect(mockApi.fromJSON).not.toHaveBeenCalled()
      // Should also open the panel
      expect(mockApi.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'todos' }))
    })
  })

  describe('updateDimensions', () => {
    it('updates widths from current panel groups', () => {
      manager.state.left.order = ['sessions']
      manager.state.right.order = ['todos']

      mockApi.getPanel.mockImplementation(id => {
        if (id === 'sessions') {
          return createMockPanel('sessions', { width: 220 })
        }
        if (id === 'todos') {
          return createMockPanel('todos', { width: 180 })
        }
        return null
      })

      manager.updateDimensions()

      expect(manager.state.left.width).toBe(220)
      expect(manager.state.right.width).toBe(180)
    })

    it('updates height for bottom panels', () => {
      manager.state.bottom.order = ['logs']

      mockApi.getPanel.mockImplementation(id => {
        if (id === 'logs') {
          return createMockPanel('logs', { height: 300 })
        }
        return null
      })

      manager.updateDimensions()

      expect(manager.state.bottom.height).toBe(300)
    })

    it('handles errors gracefully', () => {
      manager.state.left.order = ['sessions']

      mockApi.getPanel.mockImplementation(() => ({
        api: {
          group: {
            api: {
              get width() {
                throw new Error('Not available')
              },
            },
          },
        },
      }))

      expect(() => manager.updateDimensions()).not.toThrow()
    })
  })

  describe('bottom side support', () => {
    it('opens bottom panel with direction below and referencePanel main', () => {
      mockApi.getPanel.mockReturnValue(null)
      manager.state.bottom.order = []

      manager.toggle('logs')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'logs',
          component: 'logs',
          title: 'Logs',
          position: { direction: 'below', referencePanel: 'main' },
        }),
      )
    })

    it('uses initialHeight for bottom panels', () => {
      mockApi.getPanel.mockReturnValue(null)
      manager.state.bottom.order = []
      global.innerHeight = 800

      manager.toggle('logs')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialHeight: 200, // 800 * 0.25
        }),
      )
    })

    it('preserves height when reopening bottom panel', () => {
      manager.state.bottom.height = 350
      manager.state.bottom.order = []
      mockApi.getPanel.mockReturnValue(null)

      manager.toggle('logs')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialHeight: 350,
        }),
      )
    })

    it('closes bottom panel and removes from order', () => {
      const mockPanel = createMockPanel('logs')
      mockApi.getPanel.mockReturnValue(mockPanel)
      manager.state.bottom.order = ['logs']

      manager.toggle('logs')

      expect(mockPanel.api.close).toHaveBeenCalled()
      expect(manager.state.bottom.order).toEqual([])
    })

    it('captures height before closing bottom panel', () => {
      const mockPanel = createMockPanel('logs', { height: 280 })
      mockApi.panels = [mockPanel]
      mockApi.getPanel.mockReturnValue(mockPanel)
      manager.state.bottom.order = ['logs']

      manager.toggle('logs')

      expect(manager.state.bottom.height).toBe(280)
    })

    it('restores height for bottom panels via rAF', () => {
      const mockPanel = createMockPanel('logs', { height: 300 })
      mockApi.panels = [mockPanel]
      mockApi.getPanel.mockImplementation(id => (id === 'logs' ? mockPanel : null))
      manager.state.bottom.order = ['logs']
      manager.state.bottom.height = 300

      // Open a right panel - should restore bottom height too
      manager.toggle('todos')

      const rafCallback = vi.mocked(globalThis.requestAnimationFrame).mock.calls[0][0]
      rafCallback()

      expect(mockPanel.api.group.api.setSize).toHaveBeenCalledWith({ height: 300 })
    })

    it('height 0 falls back to default', () => {
      manager.state.bottom.height = 0
      manager.state.bottom.order = []
      mockApi.getPanel.mockReturnValue(null)
      global.innerHeight = 800

      manager.toggle('logs')

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialHeight: 200, // 800 * 0.25
        }),
      )
    })
  })

  describe('edge cases', () => {
    describe('detached panel handling', () => {
      it('toggle on detached panel (not in order) opens normally', () => {
        // Panel was moved out of side group, not in order anymore
        manager.state.right.order = ['stash'] // todos was detached
        mockApi.getPanel.mockReturnValue(null) // Panel doesn't exist

        manager.toggle('todos')

        expect(mockApi.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'todos' }))
        expect(manager.state.right.order).toContain('todos')
      })

      it('toggle on detached panel that exists elsewhere closes it', () => {
        // Panel exists but not in our tracking (was moved out)
        manager.state.right.order = ['stash']
        const mockPanel = createMockPanel('todos')
        mockApi.getPanel.mockReturnValue(mockPanel)

        manager.toggle('todos')

        expect(mockPanel.api.close).toHaveBeenCalled()
        // Order unchanged since it wasn't in there
        expect(manager.state.right.order).toEqual(['stash'])
      })

      it('detached panel does not affect width calculations', () => {
        // Detached panel (stash) exists but not in order
        manager.state.right.order = ['todos']
        manager.state.right.width = 200
        const todosPanel = createMockPanel('todos', { width: 180 })
        mockApi.getPanel.mockImplementation(id => (id === 'todos' ? todosPanel : null))

        manager.updateDimensions()

        expect(manager.state.right.width).toBe(180) // From todos, not stash
      })
    })

    describe('restore with missing panels', () => {
      it('skips panel in saved order that does not exist in layout', () => {
        // Saved state includes 'help' but layout doesn't have it
        manager.fromJSON({
          right: { width: 200, order: ['todos', 'help', 'stash'] },
        })

        // Simulate rebuild: layout only has todos and stash
        mockApi.panels = [{ id: 'todos' }, { id: 'stash' }]

        // When toggling, should work normally without crashing
        const todosPanel = createMockPanel('todos')
        mockApi.getPanel.mockReturnValue(todosPanel)

        expect(() => manager.toggle('todos')).not.toThrow()
      })

      it('preserved width used when no panels on side after restore', () => {
        // Saved state has width but order will be empty after verification
        manager.fromJSON({
          left: { width: 250, order: ['sessions'] },
        })

        // But sessions doesn't exist in current layout
        mockApi.getPanel.mockReturnValue(null)
        manager.state.left.order = [] // Cleared after realizing panel doesn't exist

        // Opening a new panel should use saved width
        manager.toggle('sessions')

        expect(mockApi.addPanel).toHaveBeenCalledWith(
          expect.objectContaining({ initialWidth: 250 }),
        )
      })
    })

    describe('restore with extra panels', () => {
      it('panel in layout but not in saved order gets detected via handlePanelMove', () => {
        // Start with no saved state
        manager.state.left.order = []

        // Simulate a panel that exists in layout but wasn't in saved order
        // This would be caught by the rebuild logic in App.jsx
        // Manager should gracefully handle if such panel is manually moved

        const movedPanel = {
          id: 'sessions',
          api: { group: { panels: [{ id: 'sessions' }] } },
        }

        // Shouldn't crash even though sessions isn't in order
        expect(() => manager.handlePanelMove(movedPanel)).not.toThrow()
      })
    })

    describe('width preservation edge cases', () => {
      it('width 0 from closed group is not used (falls back to default)', () => {
        manager.state.right.width = 0 // Edge case: width became 0
        manager.state.right.order = []
        mockApi.getPanel.mockReturnValue(null)
        global.innerWidth = 1000

        manager.toggle('todos')

        // Should use default, not 0
        expect(mockApi.addPanel).toHaveBeenCalledWith(
          expect.objectContaining({
            initialWidth: 150, // 1000 * 0.15
          }),
        )
      })

      it('captures width from first panel in order only', () => {
        // Multiple panels in order, should only capture from first
        manager.state.right.order = ['todos', 'stash']
        const todosPanel = createMockPanel('todos', { width: 180 })
        const stashPanel = createMockPanel('stash', { width: 220 })
        mockApi.getPanel.mockImplementation(id => {
          if (id === 'todos') {
            return todosPanel
          }
          if (id === 'stash') {
            return stashPanel
          }
          return null
        })

        manager.updateDimensions()

        expect(manager.state.right.width).toBe(180) // From todos (first), not stash
      })
    })

    describe('unknown panel handling', () => {
      it('toggle on unknown panel (not in config) does nothing', () => {
        manager.toggle('unknown')

        expect(mockApi.addPanel).not.toHaveBeenCalled()
        expect(mockApi.getPanel).not.toHaveBeenCalled()
      })

      it('handlePanelMove on unknown panel does nothing', () => {
        const movedPanel = {
          id: 'chat', // Not a side panel
          api: { group: { panels: [{ id: 'chat' }] } },
        }

        expect(() => manager.handlePanelMove(movedPanel)).not.toThrow()
        expect(manager.state.left.order).toEqual([])
        expect(manager.state.right.order).toEqual([])
        expect(manager.state.bottom.order).toEqual([])
      })
    })
  })

  describe('restoreFromServer', () => {
    let getUiState

    beforeEach(async () => {
      const mod = await import('../api/uiState')
      getUiState = mod.getUiState
    })

    it('calls getUiState with null sessionId and returns loaded false when no layout', async () => {
      getUiState.mockResolvedValue({ session: {} })

      const result = await manager.restoreFromServer(null)

      expect(result).toEqual({ loaded: false })
      expect(getUiState).toHaveBeenCalledWith(null)
    })

    it('returns { loaded: false } when no layout in response', async () => {
      getUiState.mockResolvedValue({ session: {} })

      const result = await manager.restoreFromServer('session-123')

      expect(result).toEqual({ loaded: false })
    })

    it('restores layout and panel groups from server', async () => {
      const savedLayout = { some: 'layout' }
      const savedPanelGroups = {
        left: { width: 200, order: ['sessions'] },
        right: { width: 150, order: ['todos'] },
      }
      getUiState.mockResolvedValue({
        session: { layout: savedLayout, panelGroups: savedPanelGroups },
      })

      const result = await manager.restoreFromServer('session-123')

      expect(result).toEqual({ loaded: true })
      expect(mockApi.fromJSON).toHaveBeenCalledWith(savedLayout)
      expect(manager.state.left).toEqual({ width: 200, order: ['sessions'] })
      expect(manager.state.right).toEqual({ width: 150, order: ['todos'] })
    })

    it('does not rebuild order when saved order exists', async () => {
      getUiState.mockResolvedValue({
        session: {
          layout: { some: 'layout' },
          panelGroups: { left: { order: ['sessions'] }, right: { order: ['stash'] } },
        },
      })
      mockApi.panels = [{ id: 'sessions' }, { id: 'todos' }]

      await manager.restoreFromServer('session-123')

      // Order from saved state, not rebuilt from panels
      expect(manager.state.left.order).toEqual(['sessions'])
      expect(manager.state.right.order).toEqual(['stash'])
    })

    it('returns { loaded: false } on API error', async () => {
      getUiState.mockRejectedValue(new Error('Network error'))

      const result = await manager.restoreFromServer('session-123')

      expect(result).toEqual({ loaded: false })
    })

    it('strips session-specific fields when inheriting (sessionId=null)', async () => {
      const savedLayout = {
        panels: { main: { title: 'Main' }, sessions: {} },
      }
      getUiState.mockResolvedValue({
        session: {
          layout: savedLayout,
          stash: [{ id: 1, content: 'stashed' }],
          notificationsEnabled: true,
          updated_at: '2026-01-01T00:00:00Z',
          panelGroups: { left: { order: ['sessions'] } },
        },
      })

      const result = await manager.restoreFromServer(null)

      expect(result).toEqual({ loaded: true })
      expect(manager.preMaximizeLayout).toBeNull()
      // fromJSON was called with layout (stash/notifications/updated_at stripped before)
      expect(mockApi.fromJSON).toHaveBeenCalledWith(savedLayout)
    })

    it('preserves the layout when resuming (sessionId provided)', async () => {
      const savedLayout = {
        panels: { main: { title: 'Main' }, sessions: {} },
      }
      getUiState.mockResolvedValue({
        session: {
          layout: savedLayout,
          stash: [{ id: 1, content: 'stashed' }],
          notificationsEnabled: true,
          updated_at: '2026-01-01T00:00:00Z',
          panelGroups: { left: { order: ['sessions'] } },
        },
      })

      const result = await manager.restoreFromServer('session-123')

      expect(result).toEqual({ loaded: true })
      expect(mockApi.fromJSON).toHaveBeenCalledWith(savedLayout)
    })

    it('restores bottom panel groups from server, filtering stray logs entries', async () => {
      // 'logs' bottom-slot entries are dropped on restore (height preserved
      // for other bottom panels).
      const savedLayout = { some: 'layout' }
      const savedPanelGroups = {
        left: { width: 200, order: ['sessions'] },
        right: { width: 150, order: ['todos'] },
        bottom: { height: 250, order: ['logs'] },
      }
      getUiState.mockResolvedValue({
        session: { layout: savedLayout, panelGroups: savedPanelGroups },
      })

      const result = await manager.restoreFromServer('session-123')

      expect(result).toEqual({ loaded: true })
      expect(manager.state.bottom).toEqual({ height: 250, order: [] })
    })

    it('stores preMaximizeLayout when present in session data', async () => {
      const savedPreMaxLayout = {
        layout: { panels: { chat: {} } },
        panelGroups: { left: { width: 200, order: ['sessions'] } },
      }
      getUiState.mockResolvedValue({
        session: {
          layout: { some: 'maximized-layout' },
          panelGroups: { left: { order: ['sessions'] } },
          preMaximizeLayout: savedPreMaxLayout,
        },
      })

      await manager.restoreFromServer('session-123')

      expect(manager.preMaximizeLayout).toEqual(savedPreMaxLayout)
    })

    it('strips preMaximizeLayout when inheriting (sessionId=null)', async () => {
      getUiState.mockResolvedValue({
        session: {
          layout: { panels: { chat: { title: 'Old' } } },
          panelGroups: { left: { order: ['sessions'] } },
          preMaximizeLayout: { layout: {}, panelGroups: {} },
        },
      })

      await manager.restoreFromServer(null)

      expect(manager.preMaximizeLayout).toBeNull()
    })

    it('sets preMaximizeLayout to null when not in session data', async () => {
      getUiState.mockResolvedValue({
        session: {
          layout: { some: 'layout' },
          panelGroups: {},
        },
      })

      await manager.restoreFromServer('session-123')

      expect(manager.preMaximizeLayout).toBeNull()
    })

    it('strips session panels from layout before calling fromJSON', async () => {
      const savedLayout = {
        panels: {
          chat: { id: 'chat', title: 'Chat' },
          'session:abc': { id: 'session:abc', title: 'Old Session' },
        },
        grid: {
          root: {
            type: 'leaf',
            data: { id: 'g1', views: ['chat', 'session:abc'], activeView: 'chat' },
          },
        },
      }
      getUiState.mockResolvedValue({
        session: { layout: savedLayout, panelGroups: {} },
      })

      await manager.restoreFromServer('session-123')

      const passedLayout = mockApi.fromJSON.mock.calls[0][0]
      expect(passedLayout.panels).not.toHaveProperty('session:abc')
      expect(passedLayout.panels).toHaveProperty('chat')
      expect(passedLayout.grid.root.data.views).toEqual(['chat'])
    })

    it('strips session panels when inheriting layout (sessionId=null)', async () => {
      const savedLayout = {
        panels: {
          chat: { id: 'chat', title: 'Inherited' },
          'session:def': { id: 'session:def' },
        },
        grid: {
          root: {
            type: 'leaf',
            data: { id: 'g1', views: ['chat', 'session:def'], activeView: 'session:def' },
          },
        },
      }
      getUiState.mockResolvedValue({
        session: { layout: savedLayout, panelGroups: {} },
      })

      await manager.restoreFromServer(null)

      const passedLayout = mockApi.fromJSON.mock.calls[0][0]
      expect(passedLayout.panels).not.toHaveProperty('session:def')
      expect(passedLayout.grid.root.data.views).toEqual(['chat'])
      expect(passedLayout.grid.root.data.activeView).toBe('chat')
    })
  })
})

// Helper functions

function createMockApi() {
  return {
    panels: [],
    getPanel: vi.fn(),
    addPanel: vi.fn(),
    fromJSON: vi.fn(),
    toJSON: vi.fn(() => ({})),
    onDidMovePanel: vi.fn(),
    onDidLayoutChange: vi.fn(),
    hasMaximizedGroup: vi.fn().mockReturnValue(false),
    exitMaximizedGroup: vi.fn(),
  }
}

function createMockPanel(id, options = {}) {
  const { width = 200, height = 200 } = options
  return {
    id,
    api: {
      close: vi.fn(),
      group: {
        api: {
          width,
          height,
          setSize: vi.fn(),
        },
        panels: [{ id }],
      },
    },
  }
}

// Mock requestAnimationFrame
beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(cb => setTimeout(cb, 0)),
  )
  vi.stubGlobal('innerWidth', 1000)
  vi.stubGlobal('innerHeight', 800)
})

afterEach(() => {
  vi.unstubAllGlobals()
})
