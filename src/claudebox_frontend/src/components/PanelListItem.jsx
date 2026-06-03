/** Reusable tab/filter button for panel list headers. */

/**
 * Render a panel list item button with active state and optional count badge.
 * @param {Object} props
 * @param {string} props.label - Display text.
 * @param {boolean} props.active - Whether this item is currently selected.
 * @param {Function} props.onClick - Click handler.
 * @param {number} [props.count] - Optional badge count (shown when > 0).
 * @param {string} [props.className] - Additional CSS classes.
 */
export default function PanelListItem({ label, active, onClick, count, className = '' }) {
  return (
    <button
      type="button"
      className={`panel-list-item ${className} ${active ? 'active' : ''}`}
      onClick={onClick}>
      {label}
      {count > 0 && <span className="panel-list-item-count">{count}</span>}
    </button>
  )
}
