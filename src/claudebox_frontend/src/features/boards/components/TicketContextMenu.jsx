/** Right-click context menu rendered for ticket cards and links. */

/**
 * Render the floating archive context menu at the given coordinates.
 * @param {object} props
 * @param {{x: number, y: number} | null} props.menu - Menu position; null hides the menu.
 * @param {Function} props.onClose - Callback fired when the backdrop is clicked.
 * @param {Function} props.onArchive - Callback fired when the Archive button is clicked.
 */
export default function TicketContextMenu({ menu, onClose, onArchive }) {
  if (!menu) {
    return null
  }
  return (
    <>
      <div className="ticket-context-backdrop" onClick={onClose} />
      <div className="ticket-context-menu" style={{ left: menu.x, top: menu.y }}>
        <button type="button" onClick={onArchive}>
          Archive ticket
        </button>
      </div>
    </>
  )
}
