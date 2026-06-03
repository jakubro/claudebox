/** Pure helpers for layout serialization and persistence operations. */

const FILE_COMPONENTS = new Set(['files', 'fileEditor'])

/** Strip `session:` panels — sessionStorage-only, not server-persisted. */
export function stripSessionPanels(layout) {
  return stripPanels(layout, key => key.startsWith('session:'))
}

/** Strip file panels from a persisted layout (legacy persisted IDs). */
export function stripFilePanels(layout) {
  if (!(layout?.panels && layout?.grid?.root)) {
    return layout
  }
  return stripPanels(layout, key => {
    if (FILE_COMPONENTS.has(layout.panels[key]?.view?.content?.component)) {
      return true
    }
    if (key.startsWith('file:')) {
      return true
    }
    return key === 'files'
  })
}

/** Strip legacy bottom-slot panels (currently just `logs`) from a persisted layout. */
export function stripBottomPanels(layout) {
  return stripPanels(layout, key => key === 'logs')
}

export function buildSaveOps(api, manager, preMaximizeLayout) {
  const ops = [
    { op: 'set', path: 'layout', value: stripSessionPanels(api.toJSON()) },
    { op: 'set', path: 'panelGroups', value: manager.toJSON() },
  ]
  if (preMaximizeLayout) {
    ops.push({ op: 'set', path: 'preMaximizeLayout', value: preMaximizeLayout })
  } else {
    ops.push({ op: 'unset', path: 'preMaximizeLayout' })
  }
  return ops
}

/** Strip views from a dockview layout where the predicate returns true. */
function stripPanels(layout, shouldRemoveView) {
  if (!(layout?.panels && layout?.grid?.root)) {
    return layout
  }

  const panels = { ...layout.panels }
  for (const key of Object.keys(panels)) {
    if (shouldRemoveView(key)) {
      delete panels[key]
    }
  }

  return {
    ...layout,
    panels,
    grid: { ...layout.grid, root: cleanGridNode(layout.grid.root, shouldRemoveView) },
  }
}

/** Recursively strip matching views from a dockview grid node. */
function cleanGridNode(node, shouldRemoveView) {
  if (node.type === 'leaf' && node.data?.views) {
    const views = node.data.views.filter(v => !shouldRemoveView(v))
    const activeView =
      node.data.activeView && shouldRemoveView(node.data.activeView)
        ? (views[0] ?? undefined)
        : node.data.activeView
    return { ...node, data: { ...node.data, views, activeView } }
  }
  if (node.type === 'branch' && Array.isArray(node.data)) {
    return { ...node, data: node.data.map(child => cleanGridNode(child, shouldRemoveView)) }
  }
  return node
}
