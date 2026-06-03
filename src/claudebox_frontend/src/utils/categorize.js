/** Command categorization utilities. */

export const TABS = [
  { id: 'custom', label: 'Custom' },
  { id: 'mcp', label: 'MCP' },
  { id: 'all', label: 'All' },
]

/** Category metadata for icon rendering. */
export const CATEGORY_COLORS = Object.freeze({
  custom: '#3b82f6',
  builtin: 'var(--text-muted)',
  mcp: '#22c55e',
})

/**
 * Build categorized command view from server-provided categories.
 * Each entry is `{name, usage?, description?, ...}`.
 */
export function categorizeCommands(commands) {
  const custom = commands?.custom || []
  const mcp = commands?.mcp || []
  const builtin = commands?.builtin || []
  return {
    custom,
    mcp,
    builtin,
    all: [...custom, ...mcp, ...builtin],
  }
}

/**
 * Flatten categorized commands into [{name, category, usage?, description?}].
 * @param {object} categorized - Output of categorizeCommands().
 * @param {object} [options] - Filtering options.
 * @param {boolean} [options.excludeNonInvocable=false] - Skip entries with user_invocable === false.
 */
export function flattenCommands(categorized, { excludeNonInvocable = false } = {}) {
  const items = []
  for (const category of ['custom', 'builtin', 'mcp']) {
    const cmds = categorized[category] || []
    for (const entry of cmds) {
      if (excludeNonInvocable && entry.user_invocable === false) {
        continue
      }
      items.push({ ...entry, category })
    }
  }
  return items
}
