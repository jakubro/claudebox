/** Inline context menu for a single board cell. */

/**
 * Render a context menu anchored at viewport coords with a single archive action.
 *
 * Backdrop dismisses on click. Disabled when the cell is empty.
 *
 * @param {object} props
 * @param {{x: number, y: number}} props.pos - Anchor position in viewport coords.
 * @param {string} props.label - Button label, prefilled with state/swimlane/count.
 * @param {boolean} props.disabled - Disable the action when the cell is empty.
 * @param {Function} props.onArchive - Click handler for the archive action.
 * @param {Function} props.onClose - Called on backdrop click to dismiss the menu.
 */
function CellContextMenu({ pos, label, disabled, onArchive, onClose }) {
  return (
    <>
      <div className="swimlane-context-backdrop" onClick={onClose} />
      <div className="swimlane-context-menu" style={{ left: pos.x, top: pos.y }}>
        <button type="button" disabled={disabled} onClick={onArchive}>
          {label}
        </button>
      </div>
    </>
  )
}

export default CellContextMenu
