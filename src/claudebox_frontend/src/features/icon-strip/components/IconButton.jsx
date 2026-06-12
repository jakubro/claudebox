/** Individual icon button for panel toggle. */

import PANEL_CONFIGS from '../../../config/panel'

/**
 * Render a toggle button for a panel with icon and optional badge.
 * @param {object} props
 * @param {string} props.panelId - Panel identifier from PANEL_CONFIGS.
 * @param {string[]} props.activePanels - Currently active panel IDs.
 * @param {function} props.onTogglePanel - Callback to toggle panel visibility.
 * @param {number} [props.badgeCount=0] - Optional badge count to display.
 * @param {'default'|'danger'} [props.badgeVariant='default'] - Badge color variant. 'danger' renders in red - used for failure counts (e.g., failed MCP servers) where the count signals attention is required, not just work in flight.
 * @param {boolean} [props.hasDot=false] - Show a small dot badge (no number).
 * @param {function} [props.onIconEnter] - Mouse enter handler (floating panel).
 * @param {function} [props.onIconLeave] - Mouse leave handler (floating panel).
 * @returns {JSX.Element|null} Button element or null if panelId is invalid.
 */
export default function IconButton({
  panelId,
  activePanels,
  onTogglePanel,
  badgeCount = 0,
  badgeVariant = 'default',
  hasDot = false,
  onIconEnter,
  onIconLeave,
}) {
  const config = PANEL_CONFIGS[panelId]
  if (!config) {
    return null
  }
  const { id, Icon, title, shortcut } = config
  return (
    <button
      type="button"
      data-testid={`icon-${id}`}
      className={`icon-btn ${activePanels.includes(id) ? 'active' : ''}`}
      title={shortcut ? `${title} (${shortcut})` : title}
      onClick={() => onTogglePanel(id)}
      onMouseEnter={onIconEnter ? e => onIconEnter(id, e.currentTarget) : undefined}
      onMouseLeave={onIconLeave || undefined}>
      <Icon size={14} />
      {badgeCount > 0 && (
        <span className={`icon-badge${badgeVariant === 'danger' ? ' icon-badge-danger' : ''}`}>
          {badgeCount}
        </span>
      )}
      {hasDot && !badgeCount && <span className="icon-badge-dot" />}
    </button>
  )
}
