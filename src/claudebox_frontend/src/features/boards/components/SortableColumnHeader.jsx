/** Sortable column header with drag handle, droppable target, and double-click rename mode. */

import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { renameState } from '../../../api/boards'
import { firstGrapheme } from '../utils/grapheme'

/**
 * Render a column header that can be dragged to reorder, accept ticket drops, and renamed via double-click.
 *
 * Three roles on the same node:
 * - useSortable (id `col-header:${col}`) — column reorder; activated only via
 *   the grip handle which is the sole element wired with sortable listeners.
 * - useDroppable (id `col:${col}`) — ticket drop target; `BoardTab.handleDragEnd`
 *   recognizes the `col:` and `col-header:` prefixes as column-only moves
 *   that preserve each ticket's origin swimlane.
 * - Double-click — opens an inline rename input that PATCHes the column's
 *   display label (folder and ID stay unchanged). Mirrors SwimlaneBand's
 *   rename pattern.
 *
 * @param {object} props
 * @param {string} props.col - Column identifier.
 * @param {string} props.label - Display label.
 * @param {boolean} props.collapsed - Whether the column is collapsed.
 * @param {string} props.boardId - Board ID for the rename API call.
 * @param {Function} props.refresh - Refresh board data after a successful rename.
 * @param {Function} props.onToggle - Toggle collapsed state.
 * @param {Function} props.onContextMenu - Context menu handler.
 */
export default function SortableColumnHeader({
  col,
  label,
  collapsed,
  boardId,
  refresh,
  onToggle,
  onContextMenu,
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
  } = useSortable({
    id: `col-header:${col}`,
  })
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: `col:${col}` })

  // Same DOM node serves as sortable source AND droppable target.
  const setNodeRef = node => {
    setSortableRef(node)
    setDroppableRef(node)
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const [editing, setEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(label)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.select()
    }
  }, [editing])

  const handleDoubleClick = useCallback(
    e => {
      // dblclick fires after the toggle's two single-clicks; stop propagation
      // so the active rename input doesn't trigger another collapse toggle.
      e.stopPropagation()
      setEditLabel(label)
      setEditing(true)
    },
    [label],
  )

  const handleSubmit = useCallback(async () => {
    const trimmed = editLabel.trim()
    if (!trimmed || trimmed === label) {
      setEditing(false)
      return
    }
    try {
      await renameState(boardId, col, trimmed)
      setEditing(false)
      refresh?.()
    } catch (err) {
      console.error('Failed to rename column:', err)
      setEditing(false)
    }
  }, [editLabel, label, boardId, col, refresh])

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Enter') {
        handleSubmit()
      } else if (e.key === 'Escape') {
        setEditing(false)
      }
    },
    [handleSubmit],
  )

  const displayLabel = collapsed ? firstGrapheme(label) : label

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`board-col-header${collapsed ? ' collapsed' : ''}${isOver ? ' drag-over' : ''}`}
      onDoubleClick={handleDoubleClick}
      onContextMenu={e => onContextMenu(e, col)}>
      <button type="button" className="board-col-toggle" onClick={() => onToggle(col)}>
        <span className="board-col-chevron">{collapsed ? '▸' : '▾'}</span>
        {editing ? (
          <input
            ref={inputRef}
            className="board-col-name-input"
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          displayLabel
        )}
      </button>
      {!collapsed && (
        <span className="board-drag-handle" {...attributes} {...listeners}>
          <GripHorizontal size={12} />
        </span>
      )}
    </div>
  )
}
