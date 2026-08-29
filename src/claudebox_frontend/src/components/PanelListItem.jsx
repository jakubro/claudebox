/** Reusable tab/filter button for panel list headers. */

/**
 * @param {Object} props
 * @param {string} props.label - Display text; with `icon` given, becomes the tooltip and the
 *   accessible name rather than disappearing - an icon-only control needs a non-visual handle.
 * @param {boolean} props.active - Whether this item is currently selected.
 * @param {Function} props.onClick - Click handler.
 * @param {number} [props.count] - Optional badge count (shown when > 0, or always when showZero).
 * @param {boolean} [props.showZero=false] - Show the badge at count 0 instead of hiding it.
 * @param {Function} [props.icon] - Icon component rendered in place of `label`'s text.
 * @param {string} [props.className] - Additional CSS classes.
 * @param {string} [props.testId] - data-testid, for filter strips with same-prefix labels.
 */
export default function PanelListItem({
  label,
  active,
  onClick,
  count,
  showZero = false,
  icon: Icon,
  className = '',
  testId,
}) {
  return (
    <button
      type="button"
      className={`panel-list-item ${Icon ? 'panel-list-item-icon' : ''} ${className} ${active ? 'active' : ''}`}
      onClick={onClick}
      title={Icon ? label : undefined}
      aria-label={Icon ? label : undefined}
      data-testid={testId}>
      {Icon ? <Icon size={12} /> : label}
      {(count > 0 || (showZero && count === 0)) && (
        <span className="panel-list-item-count">{count}</span>
      )}
    </button>
  )
}
