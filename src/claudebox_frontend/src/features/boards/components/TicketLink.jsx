/** Inline ticket link rendered in terse-density board cells. */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback } from 'react'
import useTicketContextMenu from '../hooks/useTicketContextMenu'
import { extractTicketId } from '../utils/ticketId'
import TicketContextMenu from './TicketContextMenu'

/**
 * Render a single ticket as an inline `<a>` ID link with hover tooltip,
 * session-attached coloring, multi-select support, drag participation, and
 * a right-click context menu mirroring TicketCard.
 *
 * @param {object} props
 * @param {object} props.ticket - Ticket data (path, title, session).
 * @param {boolean} [props.isSelected] - Whether this link is currently selected.
 * @param {Function} [props.onToggleSelect] - Toggle selection callback.
 * @param {Function} [props.onClick] - Click callback for detail overlay.
 * @param {Function} [props.onArchive] - Archive callback (terminal columns only).
 */
export default function TicketLink({ ticket, isSelected, onToggleSelect, onClick, onArchive }) {
  const { contextMenu, handleContextMenu, closeMenu, handleArchiveClick } = useTicketContextMenu(
    ticket.path,
    onArchive,
  )

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: ticket.path,
  })

  const handleClick = useCallback(
    e => {
      if (e.ctrlKey || e.metaKey) {
        onToggleSelect?.(ticket.path, e)
        return
      }
      onClick?.(ticket)
    },
    [ticket, onToggleSelect, onClick],
  )

  const className = ['ticket-link', isSelected && 'selected', ticket.session && 'session-active']
    .filter(Boolean)
    .join(' ')

  const dragStyle = { transform: CSS.Transform.toString(transform), transition }

  return (
    <>
      <button
        ref={setNodeRef}
        type="button"
        className={className}
        style={dragStyle}
        title={ticket.title || ticket.path}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        {...attributes}
        {...listeners}>
        {extractTicketId(ticket.path)}
      </button>
      <TicketContextMenu menu={contextMenu} onClose={closeMenu} onArchive={handleArchiveClick} />
    </>
  )
}
