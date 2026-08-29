/** Manage Dockview side panels with dimension preservation and canonical ordering. */

import { getWorkspaceId } from '../api/apiClient'
import { getUiState } from '../api/uiState'

// Panel titles that need special casing (acronyms, etc.)
const PANEL_TITLES = {
  mcp: 'MCP',
}

const SIDE_DIMENSION = { left: 'width', right: 'width' }
const SIDE_DIRECTION = { left: 'left', right: 'right' }
const ALL_SIDES = ['left', 'right']

export default class SidePanelManager {
  /**
   * @param {object} api - Dockview API instance
   * @param {object} config - Configuration object
   * @param {object} config.sides - Panel ID to side mapping, e.g. { sessions: 'left' }
   * @param {object} config.canonicalOrder - Order per side, e.g. { left: ['sessions'] }
   * @param {number} config.defaultWidth - Default width as fraction of window (e.g., 0.15 for 15%)
   */
  constructor(api, config) {
    this.api = api
    this.config = config
    this.preMaximizeLayout = null

    this.state = {
      left: { width: null, order: [] },
      right: { width: null, order: [] },
    }
  }

  /**
   * While maximized, toggling an already-open panel just unmaximizes it; toggling a closed
   * panel unmaximizes then opens it. Preserves group dimensions across toggles.
   */
  toggle(panelId) {
    const side = this.config.sides[panelId]
    if (!side) {
      return
    }

    // When maximized and panel already open, just unmaximize - no toggle
    if (this.api.hasMaximizedGroup() && this.state[side].order.includes(panelId)) {
      this.exitMaximize()
      return
    }

    this.exitMaximize()

    const existingPanel = this.api.getPanel(panelId)
    if (existingPanel) {
      this._withDimensionRestore(() => this._closePanel(panelId, existingPanel, side))
    } else {
      this._withDimensionRestore(() => this._openPanel(panelId, side))
    }
  }

  /** Toggle maximize state for a group; saves a layout snapshot before maximizing and restores it on un-maximize. */
  maximizeToggle(groupApi) {
    if (!groupApi) {
      return
    }

    if (groupApi.isMaximized()) {
      const snapshot = this.preMaximizeLayout
      this.preMaximizeLayout = null
      groupApi.exitMaximized()
      if (snapshot) {
        this.fromJSON(snapshot.panelGroups)
        requestAnimationFrame(() => {
          this._restoreDimensionsFromSnapshot(snapshot.panelGroups)
        })
      }
    } else {
      this.preMaximizeLayout = {
        layout: this.api.toJSON(),
        panelGroups: this.toJSON(),
      }
      groupApi.maximize()
    }
  }

  open(panelId) {
    const side = this.config.sides[panelId]
    if (!side) {
      return
    }

    if (this.api.getPanel(panelId)) {
      return
    }

    this._withDimensionRestore(() => this._openPanel(panelId, side))
  }

  close(panelId) {
    const side = this.config.sides[panelId]
    if (!side) {
      return
    }

    const existingPanel = this.api.getPanel(panelId)
    if (!existingPanel) {
      return
    }

    this._withDimensionRestore(() => this._closePanel(panelId, existingPanel, side))
  }

  /** Handle panel move event - detect detachment from side group. */
  handlePanelMove(movedPanel) {
    const panelId = movedPanel.id
    const originalSide = this.config.sides[panelId]
    if (!originalSide) {
      return
    }

    const order = this.state[originalSide].order
    const group = movedPanel.api.group

    const stillGrouped = group.panels.some(
      p => p.id !== panelId && this.config.sides[p.id] === originalSide,
    )

    if (!stillGrouped) {
      this.state[originalSide].order = order.filter(id => id !== panelId)
    }
  }

  /** Update stored dimensions from current visible groups. */
  updateDimensions() {
    for (const side of ALL_SIDES) {
      const order = this.state[side].order
      if (order.length > 0) {
        const firstPanelId = order[0]
        const panel = this.api.getPanel(firstPanelId)
        if (panel) {
          try {
            const dim = SIDE_DIMENSION[side]
            this.state[side][dim] = panel.api.group.api[dim]
          } catch (e) {
            console.warn('SidePanelManager: Failed to get panel dimension', e)
          }
        }
      }
    }
  }

  /** Serialize state for persistence. */
  toJSON() {
    return {
      left: { ...this.state.left, order: [...this.state.left.order] },
      right: { ...this.state.right, order: [...this.state.right.order] },
    }
  }

  /** Restore state from persisted data. */
  fromJSON(data) {
    if (!data) {
      return
    }

    for (const side of ALL_SIDES) {
      if (data[side]) {
        this.state[side] = { ...this.state[side], ...data[side] }
      }
    }
  }

  /**
   * Restore layout and state from server. Returns { loaded: true } if a layout was restored,
   * else { loaded: false }. Stores preMaximizeLayout internally when present.
   */
  async restoreFromServer(sessionId) {
    try {
      if (!getWorkspaceId()) {
        return { loaded: false }
      }
      const data = await getUiState(sessionId)
      const session = data.session || {}

      if (!session.layout) {
        return { loaded: false }
      }

      // When inheriting (no sessionId), strip session state - server returns it unfiltered.
      if (!sessionId) {
        delete session.stash
        delete session.notificationsEnabled
        delete session.updated_at
        delete session.preMaximizeLayout
      }

      this.api.fromJSON(session.layout)

      this.fromJSON(session.panelGroups)

      this.preMaximizeLayout = session.preMaximizeLayout || null

      return { loaded: true }
    } catch (e) {
      console.error('SidePanelManager: Failed to restore layout from server', e)
      return { loaded: false }
    }
  }

  /** Exit maximized group, restoring layout snapshot if available. No-op when no group is maximized. */
  exitMaximize() {
    if (!this.api.hasMaximizedGroup()) {
      return
    }

    const snapshot = this.preMaximizeLayout
    this.preMaximizeLayout = null
    this.api.exitMaximizedGroup()
    if (snapshot) {
      this.fromJSON(snapshot.panelGroups)
      // Defer to rAF so the grid finishes its post-exitMaximized layout pass before sizes are set.
      requestAnimationFrame(() => {
        this._restoreDimensionsFromSnapshot(snapshot.panelGroups)
      })
    }
  }

  // Private methods

  /** Capture dimensions, run operation, then restore dimensions via rAF. */
  _withDimensionRestore(operation) {
    const saved = this._captureDimensions()
    operation()
    requestAnimationFrame(() => {
      const toRestore = {}
      for (const side of ALL_SIDES) {
        const dim = SIDE_DIMENSION[side]
        toRestore[side] = saved[side] ?? this.state[side][dim]
      }
      this._restoreDimensions(toRestore)
    })
  }

  /** Capture current dimensions of all side panel groups. */
  _captureDimensions() {
    const dimensions = { left: null, right: null }
    this._forEachTrackedPanel((panel, side) => {
      const dim = SIDE_DIMENSION[side]
      dimensions[side] = panel.api.group.api[dim]
    })

    for (const side of ALL_SIDES) {
      if (dimensions[side] !== null) {
        const dim = SIDE_DIMENSION[side]
        this.state[side][dim] = dimensions[side]
      }
    }

    return dimensions
  }

  /** Restore group dimensions after layout operation. */
  _restoreDimensions(dimensions) {
    this._forEachTrackedPanel((panel, side) => {
      if (dimensions[side]) {
        const dim = SIDE_DIMENSION[side]
        panel.api.group.api.setSize({ [dim]: dimensions[side] })
      }
    })
  }

  /** Iterate tracked panels, calling callback with (panel, side) for the first panel per side. */
  _forEachTrackedPanel(callback) {
    const visited = { left: false, right: false }
    const trackedPanels = new Set([...this.state.left.order, ...this.state.right.order])

    for (const panel of this.api.panels) {
      const side = this.config.sides[panel.id]
      if (side && !visited[side] && trackedPanels.has(panel.id)) {
        try {
          callback(panel, side)
          visited[side] = true
        } catch (e) {
          console.warn(`SidePanelManager: dimension operation failed for ${panel.id}`, e)
        }
      }
    }
  }

  /** Open panel at correct position. */
  _openPanel(panelId, side) {
    const title = this._getPanelTitle(panelId)
    const order = this.state[side].order

    const { referencePanel, insertDirection } = this._findInsertionPoint(panelId, side)

    // Add to order BEFORE addPanel - onDidLayoutChange may fire synchronously
    order.push(panelId)

    if (referencePanel) {
      this.api.addPanel({
        id: panelId,
        component: panelId,
        title,
        tabComponent: 'icon',
        position: { direction: insertDirection, referencePanel },
      })
    } else {
      // First panel on this side: create new group
      const dim = SIDE_DIMENSION[side]
      const savedDim = this.state[side][dim]
      const direction = SIDE_DIRECTION[side]
      const initialWidth = savedDim || window.innerWidth * this.config.defaultWidth

      this.api.addPanel({
        id: panelId,
        component: panelId,
        title,
        tabComponent: 'icon',
        position: { direction },
        initialWidth,
      })
    }
  }

  /** Close panel and remove from tracking. */
  _closePanel(panelId, panel, side) {
    panel.api.close()
    this.state[side].order = this.state[side].order.filter(id => id !== panelId)
  }

  /** Find correct insertion point based on canonical order. */
  _findInsertionPoint(panelId, side) {
    const canonicalOrder = this.config.canonicalOrder[side]
    const activePanelIds = new Set(this.state[side].order)
    const panelIndex = canonicalOrder.indexOf(panelId)

    // Find closest visible panel ABOVE this one (stack below it)
    for (let i = panelIndex - 1; i >= 0; i--) {
      const candidate = canonicalOrder[i]
      if (activePanelIds.has(candidate) && this.api.getPanel(candidate)) {
        return { referencePanel: candidate, insertDirection: 'below' }
      }
    }

    // Find closest panel BELOW this one (stack above it)
    for (let i = panelIndex + 1; i < canonicalOrder.length; i++) {
      const candidate = canonicalOrder[i]
      if (activePanelIds.has(candidate) && this.api.getPanel(candidate)) {
        return { referencePanel: candidate, insertDirection: 'above' }
      }
    }

    return { referencePanel: null, insertDirection: 'below' }
  }

  /** Restore group dimensions from a persisted panelGroups snapshot. */
  _restoreDimensionsFromSnapshot(panelGroups) {
    if (!panelGroups) {
      return
    }
    const dimensions = {
      left: panelGroups.left?.width ?? null,
      right: panelGroups.right?.width ?? null,
    }
    this._restoreDimensions(dimensions)
  }

  _getPanelTitle(panelId) {
    return PANEL_TITLES[panelId] || panelId.charAt(0).toUpperCase() + panelId.slice(1)
  }
}
