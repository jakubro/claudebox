/** Droppable column cell within a swimlane band. */

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useMemo, useState } from 'react'
import CellContextMenu from './CellContextMenu'
import TicketCard from './TicketCard'
import TicketLink from './TicketLink'

/**
 * Render a single column cell that accepts dropped ticket cards.
 *
 * Right-click opens a context menu with a single action that archives every
 * ticket at this state×swimlane intersection, with the affected counts and
 * names embedded in the label.
 *
 * @param {object} props
 * @param {string} props.columnKey - Column identifier (e.g. 'backlog').
 * @param {string} props.columnLabel - Display label for this column.
 * @param {string} props.swimlaneId - Swimlane ID this cell belongs to.
 * @param {string} [props.swimlaneName] - Display name for this cell's swimlane.
 * @param {boolean} props.collapsed - Whether this column is collapsed.
 * @param {Array} props.tickets - Tickets in this column×swimlane cell.
 * @param {Set} props.selectedTickets - Currently selected ticket paths.
 * @param {Function} props.onToggleSelect - Toggle ticket selection.
 * @param {Function} props.onClickTicket - Open ticket detail overlay.
 * @param {Function} props.onArchive - Archive a single ticket.
 * @param {Function} [props.onArchiveCell] - Bulk-archive every ticket in this cell.
 * @param {'comfortable'|'terse'} [props.density='comfortable'] - Cell rendering mode.
 */
export default function BoardColumn({
  columnKey: _columnKey,
  columnLabel,
  swimlaneId: _swimlaneId,
  swimlaneName,
  collapsed,
  tickets,
  selectedTickets,
  onToggleSelect,
  onClickTicket,
  onArchive,
  onArchiveCell,
  density = 'comfortable',
}) {
  const droppableId = `${_columnKey}::${_swimlaneId}`
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })

  const [contextMenuPos, setContextMenuPos] = useState(null)

  const handleContextMenu = useCallback(e => {
    e.preventDefault()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
  }, [])

  const handleCloseMenu = useCallback(() => setContextMenuPos(null), [])

  const handleBulkArchive = useCallback(() => {
    setContextMenuPos(null)
    onArchiveCell?.(tickets)
  }, [tickets, onArchiveCell])

  const archiveLabel = `Archive all tickets in ${columnLabel || _columnKey} state and ${
    swimlaneName || _swimlaneId
  } swimlane (${tickets.length} tickets)`

  const sortableIds = useMemo(() => tickets.map(t => t.path), [tickets])

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`board-cell collapsed${isOver ? ' drag-over' : ''}`}
        onContextMenu={handleContextMenu}>
        {tickets.length > 0 && <span className="board-cell-count">{tickets.length}</span>}
        {contextMenuPos && (
          <CellContextMenu
            pos={contextMenuPos}
            label={archiveLabel}
            disabled={tickets.length === 0}
            onArchive={handleBulkArchive}
            onClose={handleCloseMenu}
          />
        )}
      </div>
    )
  }

  const isTerse = density === 'terse'

  return (
    <div
      ref={setNodeRef}
      className={`board-cell${isOver ? ' drag-over' : ''}${isTerse ? ' terse' : ''}`}
      onContextMenu={handleContextMenu}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {isTerse
          ? tickets.flatMap((ticket, i) => {
              const link = (
                <TicketLink
                  key={ticket.path}
                  ticket={ticket}
                  isSelected={selectedTickets.has(ticket.path)}
                  onToggleSelect={onToggleSelect}
                  onClick={onClickTicket}
                  onArchive={onArchive}
                />
              )
              return i < tickets.length - 1 ? [link, ', '] : [link]
            })
          : tickets.map(ticket => (
              <TicketCard
                key={ticket.path}
                ticket={ticket}
                isSelected={selectedTickets.has(ticket.path)}
                onToggleSelect={onToggleSelect}
                onClick={onClickTicket}
                onArchive={onArchive}
              />
            ))}
      </SortableContext>
      {contextMenuPos && (
        <CellContextMenu
          pos={contextMenuPos}
          label={archiveLabel}
          disabled={tickets.length === 0}
          onArchive={handleBulkArchive}
          onClose={handleCloseMenu}
        />
      )}
    </div>
  )
}
