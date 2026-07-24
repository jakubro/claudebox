/** Draggable ticket card displaying title, session status, and selection state. */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useSessionsList } from '../../../context/SessionsContext'
import useTicketContextMenu from '../hooks/useTicketContextMenu'
import TicketContextMenu from './TicketContextMenu'

/**
 * Render a single ticket card with drag support, selection, and session status.
 * @param {object} props
 * @param {object} props.ticket - Ticket data (path, title, session, status).
 * @param {boolean} [props.isSelected] - Whether this card is currently selected.
 * @param {Function} [props.onToggleSelect] - Toggle selection callback.
 * @param {Function} [props.onClick] - Click callback for detail overlay.
 * @param {Function} [props.onArchive] - Archive callback (terminal columns only).
 * @param {boolean} [props.isDragOverlay] - Whether this is the drag overlay ghost.
 */
export default function TicketCard({
  ticket,
  isSelected,
  onToggleSelect,
  onClick,
  onArchive,
  isDragOverlay,
}) {
  const { contextMenu, handleContextMenu, closeMenu, handleArchiveClick } = useTicketContextMenu(
    ticket.path,
    onArchive,
  )
  const { deriveSessionStatus } = useContainerMap()
  const { sessions } = useSessionsList()

  const { attributes, listeners, setNodeRef, isDragging, transform, transition } = useSortable({
    id: ticket.path,
    disabled: isDragOverlay,
  })

  const dragStyle = isDragOverlay
    ? undefined
    : { transform: CSS.Transform.toString(transform), transition }

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

  const handleCheckboxChange = useCallback(
    e => {
      e.stopPropagation()
      onToggleSelect?.(ticket.path)
    },
    [ticket.path, onToggleSelect],
  )

  // Live session status from the shared derivation: 'running' | 'stopping' | 'none'.
  // Mapped to the card's dot/label vocabulary (none -> gray "stopped").
  const sessionStatus = ticket.session ? deriveSessionStatus(ticket.session, sessions) : null
  const statusClass =
    sessionStatus === 'running' ? 'running' : sessionStatus === 'stopping' ? 'stopping' : 'stopped'

  const className = [
    'ticket-card',
    isSelected && 'selected',
    isDragging && 'dragging',
    isDragOverlay && 'drag-overlay',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      className={className}
      style={dragStyle}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      {...(isDragOverlay ? {} : { ...attributes, ...listeners })}>
      <div className="ticket-card-title-row">
        <input
          type="checkbox"
          className="ticket-card-checkbox"
          checked={!!isSelected}
          onChange={handleCheckboxChange}
          onClick={e => e.stopPropagation()}
        />
        <div className="ticket-card-title">{ticket.title}</div>
      </div>
      {ticket.session && (
        <div className="ticket-card-session">
          <span className={`ticket-status-dot ${statusClass}`} />
          <span className="ticket-session-id">
            {statusClass} ({ticket.session.slice(0, 4)}..)
          </span>
        </div>
      )}

      <TicketContextMenu menu={contextMenu} onClose={closeMenu} onArchive={handleArchiveClick} />
    </div>
  )
}
