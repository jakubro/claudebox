/** Build the default dockview panel layout for new sessions. */

import { DEFAULT_PANEL_WIDTH } from '../../../config/dimensions'

/**
 * Apply or remove `data-main-group` on every group based on whether it hosts only the main panel.
 * Re-applied on layout events (fromJSON restore, drag-create, panel-move) that the synchronous
 * setAttribute in `buildDefaultLayout` doesn't cover.
 */
export function applyMainGroupMarker(api) {
  for (const group of api.groups) {
    const isOnlyMain = group.panels.length === 1 && group.panels[0]?.id === 'main'
    if (isOnlyMain) {
      group.element?.setAttribute('data-main-group', 'true')
    } else {
      group.element?.removeAttribute('data-main-group')
    }
  }
}

export function buildDefaultLayout(api, manager) {
  const main = api.addPanel({
    id: 'main',
    component: 'main',
    // Title never displayed - the main panel has no tab bar.
    title: 'Main',
  })

  // Mark the main panel's group synchronously so MainPanel.css can target it at first paint - a
  // lazily-evaluated CSS selector would flash the dockview tab bar before React mounts.
  main.group?.element?.setAttribute('data-main-group', 'true')

  // Left side: only the Sessions panel opens by default; it anchors the left group with a sized width.
  addPanelColumn(api, manager, 'left', ['sessions'])

  // Right side: Todos, Stash, Tasks, Bookmarks, Boards open by default in canonical order; Usage and
  // MCP stay hidden until toggled via the icon strip. Bookmarks/Boards seed here (not left) because
  // PANEL_SIDES routes them to the right strip.
  addPanelColumn(api, manager, 'right', ['todos', 'stash', 'tasks', 'bookmarks', 'boards'])
}

/**
 * Add a stacked column of panels anchored to the main panel on one side; the first panel sets
 * the column width, subsequent panels stack below.
 */
function addPanelColumn(api, manager, side, panelIds) {
  panelIds.forEach((panelId, i) => {
    const title = panelId.charAt(0).toUpperCase() + panelId.slice(1)
    if (i === 0) {
      api.addPanel({
        id: panelId,
        component: panelId,
        title,
        tabComponent: 'icon',
        position: { direction: side, referencePanel: 'main' },
        initialWidth: window.innerWidth * DEFAULT_PANEL_WIDTH,
      })
    } else {
      api.addPanel({
        id: panelId,
        component: panelId,
        title,
        tabComponent: 'icon',
        position: { direction: 'below', referencePanel: panelIds[i - 1] },
      })
    }
    manager.state[side === 'left' ? 'left' : 'right'].order.push(panelId)
  })
}
