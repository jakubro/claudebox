/** Horizontal swimlane band spanning all columns with CRUD header. */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  archiveTicket,
  deleteSwimlane,
  renameSwimlane,
  reorderSwimlanes,
} from '../../../api/boards'
import { getLaneTickets } from '../utils/laneTickets'

/**
 * Render a swimlane header row and its column cells.
 * @param {object} props
 * @param {object} props.lane - Swimlane data ({ id, name }).
 * @param {string} props.boardId - Board ID for API calls.
 * @param {Function} props.refresh - Refresh board data.
 * @param {boolean} [props.isUnsorted] - Whether this is the unsorted catch-all lane.
 * @param {string[]} [props.swimlaneIds] - All swimlane IDs in order (for reorder).
 * @param {string} [props.sortableId] - DND sortable ID for drag-and-drop reorder.
 * @param {boolean} [props.collapsed] - Whether this swimlane is collapsed.
 * @param {Function} [props.onToggleCollapse] - Toggle collapse callback.
 * @param {object} [props.allTickets] - All board columns data for bulk archive.
 * @param {React.ReactNode} props.children - BoardColumn cells.
 */
export default function SwimlaneBand({
  lane,
  boardId,
  refresh,
  isUnsorted,
  swimlaneIds,
  sortableId,
  collapsed,
  onToggleCollapse,
  allTickets,
  children,
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: sortableId || `lane-unsorted:${lane.id}`,
    disabled: isUnsorted || !sortableId,
  })
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(lane.name)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const inputRef = useRef(null)

  const handleDoubleClick = useCallback(() => {
    if (isUnsorted) {
      return
    }
    setEditName(lane.name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }, [isUnsorted, lane.name])

  const handleRenameSubmit = useCallback(async () => {
    setEditing(false)
    const trimmed = editName.trim()
    if (!trimmed || trimmed === lane.name) {
      return
    }
    try {
      await renameSwimlane(boardId, lane.id, trimmed)
      refresh()
    } catch (err) {
      console.error('Failed to rename swimlane:', err)
    }
  }, [boardId, lane.id, lane.name, editName, refresh])

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Enter') {
        handleRenameSubmit()
      }
      if (e.key === 'Escape') {
        setEditing(false)
      }
    },
    [handleRenameSubmit],
  )

  const handleContextMenu = useCallback(
    e => {
      if (isUnsorted) {
        return
      }
      e.preventDefault()
      setContextMenuPos({ x: e.clientX, y: e.clientY })
      setShowContextMenu(true)
    },
    [isUnsorted],
  )

  const handleDelete = useCallback(async () => {
    setShowContextMenu(false)
    try {
      await deleteSwimlane(boardId, lane.id)
      refresh()
    } catch (err) {
      console.error('Failed to delete swimlane:', err)
    }
  }, [boardId, lane.id, refresh])

  const handleRename = useCallback(() => {
    setShowContextMenu(false)
    handleDoubleClick()
  }, [handleDoubleClick])

  const handleMove = useCallback(
    async direction => {
      setShowContextMenu(false)
      if (!swimlaneIds) {
        return
      }
      const idx = swimlaneIds.indexOf(lane.id)
      if (idx < 0) {
        return
      }
      const newIds = [...swimlaneIds]
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= newIds.length) {
        return
      }
      ;[newIds[idx], newIds[targetIdx]] = [newIds[targetIdx], newIds[idx]]
      try {
        await reorderSwimlanes(boardId, newIds)
        refresh()
      } catch (err) {
        console.error('Failed to reorder swimlanes:', err)
      }
    },
    [boardId, lane.id, swimlaneIds, refresh],
  )

  // Collect all tickets in this swimlane across all columns
  const laneTickets = useMemo(
    () => getLaneTickets(allTickets, lane.id, isUnsorted, swimlaneIds),
    [allTickets, lane.id, isUnsorted, swimlaneIds],
  )

  const handleBulkArchive = useCallback(async () => {
    setShowContextMenu(false)
    if (laneTickets.length === 0) {
      return
    }
    try {
      for (const ticket of laneTickets) {
        await archiveTicket(boardId, ticket.path)
      }
      refresh()
    } catch (err) {
      console.error('Failed to bulk archive swimlane:', err)
    }
  }, [boardId, laneTickets, refresh])

  return (
    <div ref={setNodeRef} style={sortableStyle} className="swimlane-band">
      <div
        className={`swimlane-header${isUnsorted ? ' unsorted' : ''}${collapsed ? ' collapsed' : ''}`}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}>
        {!isUnsorted && sortableId && (
          <span className="board-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={12} />
          </span>
        )}
        <button
          type="button"
          className="swimlane-collapse-toggle"
          onClick={() => onToggleCollapse?.(lane.id)}>
          <span className="board-col-chevron">{collapsed ? '▸' : '▾'}</span>
        </button>
        {editing ? (
          <input
            ref={inputRef}
            className="swimlane-name-input"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <span className="swimlane-name">{lane.name}</span>
        )}
      </div>

      {!collapsed && <div className="swimlane-columns">{children}</div>}

      {showContextMenu && (
        <>
          <div className="swimlane-context-backdrop" onClick={() => setShowContextMenu(false)} />
          <div
            className="swimlane-context-menu"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}>
            <button type="button" onClick={handleRename}>
              Rename
            </button>
            <button type="button" onClick={handleDelete}>
              Delete
            </button>
            <hr className="swimlane-context-divider" />
            <button type="button" onClick={() => handleMove('up')}>
              Move up
            </button>
            <button type="button" onClick={() => handleMove('down')}>
              Move down
            </button>
            <hr className="swimlane-context-divider" />
            <button type="button" disabled={laneTickets.length === 0} onClick={handleBulkArchive}>
              {`Archive all tickets in ${lane.name} swimlane (${laneTickets.length} tickets)`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
