/** Board view rendered inside the main panel — columns, swimlanes, and drag-and-drop. */

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  archiveTicket,
  assignTickets,
  moveTicket,
  reorderStates,
  reorderSwimlanes,
} from '../../api/boards'
import { useSessionRouting } from '../../context/SessionRoutingContext'
import AddSwimlaneRow from './components/AddSwimlaneRow'
import BoardColumn from './components/BoardColumn'
import BoardControlBar from './components/BoardControlBar'
import SortableColumnHeader from './components/SortableColumnHeader'
import SwimlaneBand from './components/SwimlaneBand'
import TicketCard from './components/TicketCard'
import TicketDetail from './components/TicketDetail'
import useBoardData from './hooks/useBoardData'
import { computeFlatDropIndex, isSelfDrop } from './utils/dropIndex'
import { planTicketMove } from './utils/planTicketMove'
import { preferTicketCollisions } from './utils/preferTicketCollisions'

/**
 * Render a full board for the main panel slot when the URL targets a board.
 *
 * @param {object} props
 * @param {string} props.boardId - Board ID to display.
 */
function BoardTab({ boardId }) {
  const { density } = useSessionRouting()
  const { board, loading, error, refresh } = useBoardData(boardId)
  const [selectedTickets, setSelectedTickets] = useState(new Set())
  const [detailTicket, setDetailTicket] = useState(null)
  const [collapsedColumns, setCollapsedColumns] = useState(new Set())
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState(new Set())
  const [activeId, setActiveId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  // Derive columns, labels, and terminal set from board.states
  const columns = useMemo(() => {
    if (!board?.states) {
      return []
    }
    return board.states.map(s => s.id)
  }, [board])

  const columnLabels = useMemo(() => {
    if (!board?.states) {
      return {}
    }
    return Object.fromEntries(board.states.map(s => [s.id, s.label]))
  }, [board])

  const terminalColumns = useMemo(() => {
    if (!board?.states) {
      return new Set()
    }
    return new Set(board.states.filter(s => s.terminal).map(s => s.id))
  }, [board])

  const activeColumns = useMemo(() => {
    if (!board?.states) {
      return new Set()
    }
    return new Set(board.states.filter(s => s.active).map(s => s.id))
  }, [board])

  // Drive the board grid's column track widths. Collapsed columns shrink to
  // 32px; expanded columns share remaining space via minmax(200px, 1fr).
  // Recomputed when columns reorder or collapse state changes — every cell
  // and header in the same column inherits the same track width.
  const gridTemplateColumns = useMemo(
    () => columns.map(c => (collapsedColumns.has(c) ? '32px' : 'minmax(200px, 1fr)')).join(' '),
    [columns, collapsedColumns],
  )

  // Initialize collapsed columns from terminal states on board identity change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on board identity only
  useEffect(() => {
    if (board?.states) {
      setCollapsedColumns(new Set(board.states.filter(s => s.terminal).map(s => s.id)))
    }
  }, [board?.id])

  // Build a flat lookup of all tickets by path
  const ticketsByPath = useMemo(() => {
    if (!board?.columns) {
      return {}
    }
    const map = {}
    for (const [col, tickets] of Object.entries(board.columns)) {
      for (const ticket of tickets) {
        map[ticket.path] = { ...ticket, column: col, boardId }
      }
    }
    return map
  }, [board, boardId])

  const activeTicket = activeId ? ticketsByPath[activeId] : null

  // Group tickets by swimlane × column
  const swimlaneIds = useMemo(() => {
    if (!board?.swimlanes) {
      return []
    }
    return board.swimlanes.map(s => s.id)
  }, [board])

  const handleToggleColumn = useCallback(col => {
    setCollapsedColumns(prev => {
      const next = new Set(prev)
      if (next.has(col)) {
        next.delete(col)
      } else {
        next.add(col)
      }
      return next
    })
  }, [])

  const handleToggleSwimlane = useCallback(laneId => {
    setCollapsedSwimlanes(prev => {
      const next = new Set(prev)
      if (next.has(laneId)) {
        next.delete(laneId)
      } else {
        next.add(laneId)
      }
      return next
    })
  }, [])

  const handleToggleSelect = useCallback((path, event) => {
    setSelectedTickets(prev => {
      const isMulti = event?.ctrlKey || event?.metaKey
      const isCheckbox = !event
      const next = new Set(isMulti || isCheckbox ? prev : [])
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleClickTicket = useCallback(
    ticket => setDetailTicket(ticketsByPath[ticket.path] || ticket),
    [ticketsByPath],
  )

  const handleDragStart = useCallback(event => {
    setActiveId(event.active.id)
  }, [])

  const handleDragEnd = useCallback(
    async event => {
      setActiveId(null)
      const { active, over } = event
      if (!(over && board)) {
        return
      }

      const activeStr = String(active.id)
      const overStr = String(over.id)

      // Column header reorder
      if (activeStr.startsWith('col-header:') && overStr.startsWith('col-header:')) {
        const fromCol = activeStr.replace('col-header:', '')
        const toCol = overStr.replace('col-header:', '')
        if (fromCol === toCol) {
          return
        }
        const newOrder = [...columns]
        const fromIdx = newOrder.indexOf(fromCol)
        const toIdx = newOrder.indexOf(toCol)
        newOrder.splice(fromIdx, 1)
        newOrder.splice(toIdx, 0, fromCol)
        try {
          await reorderStates(boardId, newOrder)
          refresh()
        } catch (err) {
          console.error('Failed to reorder columns:', err)
        }
        return
      }

      // Swimlane header reorder
      if (activeStr.startsWith('lane-header:') && overStr.startsWith('lane-header:')) {
        const fromLane = activeStr.replace('lane-header:', '')
        const toLane = overStr.replace('lane-header:', '')
        if (fromLane === toLane) {
          return
        }
        const newOrder = [...swimlaneIds]
        const fromIdx = newOrder.indexOf(fromLane)
        const toIdx = newOrder.indexOf(toLane)
        newOrder.splice(fromIdx, 1)
        newOrder.splice(toIdx, 0, fromLane)
        try {
          await reorderSwimlanes(boardId, newOrder)
          refresh()
        } catch (err) {
          console.error('Failed to reorder swimlanes:', err)
        }
        return
      }

      // Ticket card move — bulk-aware. Dragging a selected ticket carries
      // every selected ticket with it; dragging an unselected ticket moves
      // just that one (selection unchanged).
      const ticketPath = activeStr

      // over-id parsing — three shapes:
      //   `col-header:` / `col:`  — column-only move, lane preserved per ticket
      //   `${col}::${lane}`       — cell drop (target col + lane)
      //   another ticket path      — drop ON a ticket (insert at that visual slot)
      let targetCol
      let targetSwimlane
      let dropIndex
      const overTicket = ticketsByPath[overStr]
      if (overTicket && !isSelfDrop(ticketPath, overStr)) {
        targetCol = overTicket.column
        targetSwimlane = overTicket.swimlane || '__unsorted__'
        const colTickets = board.columns[targetCol] || []
        dropIndex = computeFlatDropIndex(colTickets, targetSwimlane, overStr)
      } else if (overStr.startsWith('col-header:')) {
        targetCol = overStr.slice('col-header:'.length)
        targetSwimlane = null
      } else if (overStr.startsWith('col:')) {
        targetCol = overStr.slice('col:'.length)
        targetSwimlane = null
      } else {
        ;[targetCol, targetSwimlane] = overStr.split('::')
      }

      const ticket = ticketsByPath[ticketPath]
      if (!ticket) {
        return
      }

      const ticketsToMove = selectedTickets.has(ticketPath)
        ? Array.from(selectedTickets).filter(p => ticketsByPath[p])
        : [ticketPath]

      // When the selection spans multiple swimlanes, preserve each ticket's
      // origin lane on cell drops — unifying every ticket into the drop
      // target's lane unconditionally would lose per-ticket categorization.
      const sourceLanes = new Set(
        ticketsToMove.map(p => ticketsByPath[p]?.swimlane || '__unsorted__'),
      )
      const isCrossLaneMove = sourceLanes.size > 1

      try {
        let nextIndex = dropIndex
        for (const path of ticketsToMove) {
          const plan = planTicketMove({
            ticket: ticketsByPath[path],
            targetCol,
            targetSwimlane,
            isCrossLaneMove,
            nextIndex,
          })
          if (!plan) {
            continue
          }
          await moveTicket(boardId, path, plan.body)
          if (plan.advanceIndex) {
            nextIndex += 1
          }
        }

        // Auto-assign when the destination is an active column.
        if (activeColumns.has(targetCol) && ticketsToMove.length > 0) {
          try {
            if (ticketsToMove.length === 1) {
              // Single-ticket case: only assign if it doesn't already own a session.
              if (!ticketsByPath[ticketsToMove[0]]?.session) {
                await assignTickets(boardId, ticketsToMove)
              }
            } else {
              // Bulk case: spawn ONE shared session and reassign every selected
              // ticket to it (overwriting any prior associations).
              await assignTickets(boardId, ticketsToMove, { parallel: false })
            }
          } catch (err) {
            console.error('Failed to auto-assign ticket:', err)
          }
        }

        refresh()
      } catch (err) {
        console.error('Failed to move ticket:', err)
      }
    },
    [board, boardId, columns, swimlaneIds, activeColumns, ticketsByPath, selectedTickets, refresh],
  )

  const [colContextMenu, setColContextMenu] = useState(null)

  const handleColumnContextMenu = useCallback((e, col) => {
    e.preventDefault()
    setColContextMenu({ col, x: e.clientX, y: e.clientY })
  }, [])

  const handleMoveColumn = useCallback(
    async (col, direction) => {
      setColContextMenu(null)
      const idx = columns.indexOf(col)
      if (idx < 0) {
        return
      }
      const targetIdx = direction === 'left' ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= columns.length) {
        return
      }
      const newOrder = [...columns]
      newOrder.splice(idx, 1)
      newOrder.splice(targetIdx, 0, col)
      try {
        await reorderStates(boardId, newOrder)
        refresh()
      } catch (err) {
        console.error('Failed to reorder columns:', err)
      }
    },
    [columns, boardId, refresh],
  )

  const handleArchive = useCallback(
    async ticketPath => {
      try {
        await archiveTicket(boardId, ticketPath)
        refresh()
      } catch (err) {
        console.error('Failed to archive ticket:', err)
      }
    },
    [boardId, refresh],
  )

  const handleBulkArchiveCell = useCallback(
    async tickets => {
      if (!tickets || tickets.length === 0) {
        return
      }
      try {
        for (const ticket of tickets) {
          await archiveTicket(boardId, ticket.path)
        }
        refresh()
      } catch (err) {
        console.error('Failed to bulk archive cell:', err)
      }
    },
    [boardId, refresh],
  )

  const handleBulkArchiveColumn = useCallback(
    async col => {
      setColContextMenu(null)
      const tickets = board?.columns[col] || []
      if (tickets.length === 0) {
        return
      }
      try {
        for (const ticket of tickets) {
          await archiveTicket(boardId, ticket.path)
        }
        refresh()
      } catch (err) {
        console.error('Failed to bulk archive column:', err)
      }
    },
    [board, boardId, refresh],
  )

  if (loading) {
    return (
      <div className="board-loading">
        <Loader2 size={20} className="board-spinner" />
        Loading board...
      </div>
    )
  }

  if (error) {
    return <div className="board-error">Failed to parse board.yaml: {error}</div>
  }

  if (!board) {
    return null
  }

  return (
    <div className="board-tab">
      <BoardControlBar />
      <DndContext
        sensors={sensors}
        collisionDetection={preferTicketCollisions}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}>
        <div className="board-board" style={{ gridTemplateColumns }}>
          <SortableContext
            items={columns.map(c => `col-header:${c}`)}
            strategy={horizontalListSortingStrategy}>
            <div className="board-header-row">
              {columns.map(col => (
                <SortableColumnHeader
                  key={col}
                  col={col}
                  label={columnLabels[col]}
                  collapsed={collapsedColumns.has(col)}
                  boardId={boardId}
                  refresh={refresh}
                  onToggle={handleToggleColumn}
                  onContextMenu={handleColumnContextMenu}
                />
              ))}
              {colContextMenu && (
                <>
                  <div
                    className="swimlane-context-backdrop"
                    onClick={() => setColContextMenu(null)}
                  />
                  <div
                    className="swimlane-context-menu"
                    style={{ left: colContextMenu.x, top: colContextMenu.y }}>
                    <button
                      type="button"
                      disabled={columns.indexOf(colContextMenu.col) === 0}
                      onClick={() => handleMoveColumn(colContextMenu.col, 'left')}>
                      Move left
                    </button>
                    <button
                      type="button"
                      disabled={columns.indexOf(colContextMenu.col) === columns.length - 1}
                      onClick={() => handleMoveColumn(colContextMenu.col, 'right')}>
                      Move right
                    </button>
                    <hr className="swimlane-context-divider" />
                    <button
                      type="button"
                      disabled={(board?.columns[colContextMenu.col] || []).length === 0}
                      onClick={() => handleBulkArchiveColumn(colContextMenu.col)}>
                      {`Archive all tickets in ${columnLabels[colContextMenu.col]} state (${(board?.columns[colContextMenu.col] || []).length} tickets)`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </SortableContext>

          <SortableContext
            items={swimlaneIds.map(id => `lane-header:${id}`)}
            strategy={verticalListSortingStrategy}>
            {swimlaneIds.map(laneId => {
              const lane = board.swimlanes.find(s => s.id === laneId)
              return (
                <SwimlaneBand
                  key={laneId}
                  lane={lane}
                  boardId={boardId}
                  refresh={refresh}
                  swimlaneIds={swimlaneIds}
                  sortableId={`lane-header:${laneId}`}
                  collapsed={collapsedSwimlanes.has(laneId)}
                  onToggleCollapse={handleToggleSwimlane}
                  allTickets={board.columns}>
                  {columns.map(col => (
                    <BoardColumn
                      key={col}
                      columnKey={col}
                      columnLabel={columnLabels[col]}
                      swimlaneId={laneId}
                      swimlaneName={lane?.name || laneId}
                      collapsed={collapsedColumns.has(col)}
                      tickets={(board.columns[col] || []).filter(t => t.swimlane === laneId)}
                      selectedTickets={selectedTickets}
                      onToggleSelect={handleToggleSelect}
                      onClickTicket={handleClickTicket}
                      onArchive={handleArchive}
                      onArchiveCell={handleBulkArchiveCell}
                      density={density}
                    />
                  ))}
                </SwimlaneBand>
              )
            })}
          </SortableContext>

          {/* Unsorted swimlane for tickets without a swimlane */}
          <SwimlaneBand
            lane={{ id: '__unsorted__', name: '(Unsorted)' }}
            boardId={boardId}
            refresh={refresh}
            isUnsorted
            collapsed={collapsedSwimlanes.has('__unsorted__')}
            onToggleCollapse={handleToggleSwimlane}
            allTickets={board.columns}>
            {columns.map(col => (
              <BoardColumn
                key={col}
                columnKey={col}
                columnLabel={columnLabels[col]}
                swimlaneId="__unsorted__"
                swimlaneName="(Unsorted)"
                collapsed={collapsedColumns.has(col)}
                tickets={(board.columns[col] || []).filter(
                  t => !(t.swimlane && swimlaneIds.includes(t.swimlane)),
                )}
                selectedTickets={selectedTickets}
                onToggleSelect={handleToggleSelect}
                onClickTicket={handleClickTicket}
                onArchive={handleArchive}
                onArchiveCell={handleBulkArchiveCell}
                isTerminal={terminalColumns.has(col)}
                density={density}
              />
            ))}
          </SwimlaneBand>

          <AddSwimlaneRow boardId={boardId} refresh={refresh} />
        </div>

        <DragOverlay>
          {activeTicket ? <TicketCard ticket={activeTicket} isDragOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {detailTicket && (
        <TicketDetail
          ticket={detailTicket}
          states={board.states}
          swimlanes={board.swimlanes}
          onClose={() => setDetailTicket(null)}
        />
      )}
    </div>
  )
}

export default BoardTab
