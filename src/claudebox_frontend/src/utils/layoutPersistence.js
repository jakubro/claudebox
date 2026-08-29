/** Pure helpers for layout serialization and persistence operations. */

export function buildSaveOps(api, manager, preMaximizeLayout) {
  const ops = [
    { op: 'set', path: 'layout', value: api.toJSON() },
    { op: 'set', path: 'panelGroups', value: manager.toJSON() },
  ]
  if (preMaximizeLayout) {
    ops.push({ op: 'set', path: 'preMaximizeLayout', value: preMaximizeLayout })
  } else {
    ops.push({ op: 'unset', path: 'preMaximizeLayout' })
  }
  return ops
}
