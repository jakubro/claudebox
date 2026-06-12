/** Build the default dockview panel layout for new sessions. */

import { DEFAULT_PANEL_WIDTH } from '../../../config/dimensions'

/**
 * Apply or remove the `data-main-group` attribute on every group based on
 * whether it hosts the main panel as its sole content. Used as a re-application
 * pass on layout events (fromJSON restore, drag-create, panel-move) where the
 * synchronous setAttribute in `buildDefaultLayout` does not cover the group.
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

  // Mark the main panel's group synchronously so MainPanel.css can target it
  // at first paint. The previous :has([data-testid="main-panel"]) selector
  // was evaluated lazily by the browser, briefly flashing the dockview tab
  // bar before React mounted the inner content.
  main.group?.element?.setAttribute('data-main-group', 'true')

  // Left side: only the Sessions panel opens by default; it anchors the
  // left group with a sized width.
  addPanelColumn(api, manager, 'left', ['sessions'])

  // Right side: Todos, Stash, Tasks, Bookmarks, Boards open by default in
  // canonical order. Usage and MCP remain hidden - users can toggle them
  // on via the icon strip. Bookmarks/Boards seed here (not on the left)
  // because PANEL_SIDES routes them to the right strip.
  addPanelColumn(api, manager, 'right', ['todos', 'stash', 'tasks', 'bookmarks', 'boards'])
}

/**
 * Add a stacked column of panels anchored to the main panel on one side.
 * The first panel sets the column width; subsequent panels stack below.
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
