/** Left panel listing discovered boards for the current workspace. */

import { Check, Pencil, RefreshCw, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { renameBoard } from '../../api/boards'
import { useEvents } from '../../context/EventsContext'
import { useSessionRouting } from '../../context/SessionRoutingContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { flashStatus } from '../../utils/flashStatus'
import { openBoardInNewTab } from '../../utils/navigation'
import useBoardList from './hooks/useBoardList'

/**
 * Render the boards discovery panel in the right icon strip.
 * @param {object} props
 * @param {object} [props.containerApi] - Dockview container API.
 */
function BoardsPanel({ containerApi: _containerApi }) {
  const { boards, loading, error, refresh } = useBoardList()
  const { navigateToBoard } = useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { startOpeningBoard, clearOpeningBoard } = useEvents()

  const [editingBoardId, setEditingBoardId] = useState(null)
  const [editValue, setEditValue] = useState('')

  const handleBoardClick = useCallback(
    board => {
      flashStatus(startOpeningBoard, clearOpeningBoard)
      if (workspaceId) {
        navigateToBoard(workspaceId, board.id)
      }
    },
    [navigateToBoard, workspaceId, startOpeningBoard, clearOpeningBoard],
  )

  const handleBoardOpenInNewTab = useCallback(
    boardId => {
      if (!workspaceId) {
        return
      }
      flashStatus(startOpeningBoard, clearOpeningBoard)
      openBoardInNewTab(workspaceId, boardId)
    },
    [workspaceId, startOpeningBoard, clearOpeningBoard],
  )

  const handleEditStart = useCallback((e, board) => {
    e.stopPropagation()
    setEditingBoardId(board.id)
    setEditValue(board.name)
  }, [])

  const handleRenameCancel = useCallback(() => {
    setEditingBoardId(null)
    setEditValue('')
  }, [])

  const handleRenameSave = useCallback(
    async boardId => {
      const trimmed = editValue.trim()
      if (trimmed) {
        try {
          await renameBoard(boardId, trimmed)
          refresh()
        } catch {
          // Silently fail - board list will show stale name until next refresh
        }
      }
      setEditingBoardId(null)
      setEditValue('')
    },
    [editValue, refresh],
  )

  if (error) {
    return (
      <div className="boards-panel boards-error" data-testid="panel-boards">
        Failed to load boards
      </div>
    )
  }

  if (loading && boards.length === 0) {
    return (
      <div className="boards-panel boards-loading" data-testid="panel-boards">
        Loading...
      </div>
    )
  }

  const metaRefresh = (
    <button
      type="button"
      className="boards-meta-refresh"
      onClick={refresh}
      title="Refresh boards list"
      data-testid="boards-refresh-meta">
      <RefreshCw size={12} />
      <span>Refresh</span>
    </button>
  )

  if (boards.length === 0) {
    return (
      <div className="boards-panel" data-testid="panel-boards">
        <div className="boards-list boards-list-empty">
          <div className="boards-empty-placeholder">No boards found</div>
          {metaRefresh}
        </div>
      </div>
    )
  }

  return (
    <div className="boards-panel" data-testid="panel-boards">
      <div className="boards-list">
        {boards.map(board => (
          <div key={board.id} className="boards-item">
            {editingBoardId === board.id ? (
              <div className="boards-item-edit-row">
                <input
                  type="text"
                  className="boards-item-edit"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleRenameSave(board.id)
                    }
                    if (e.key === 'Escape') {
                      handleRenameCancel()
                    }
                  }}
                  onClick={e => e.stopPropagation()}
                />
                <button
                  type="button"
                  className="boards-edit-btn"
                  onClick={e => {
                    e.stopPropagation()
                    void handleRenameSave(board.id)
                  }}
                  title="Save">
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className="boards-edit-btn"
                  onClick={e => {
                    e.stopPropagation()
                    handleRenameCancel()
                  }}
                  title="Cancel">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="boards-item-clickable"
                onClick={e => {
                  if (e.altKey) {
                    handleBoardOpenInNewTab(board.id)
                    return
                  }
                  handleBoardClick(board)
                }}
                onAuxClick={e => {
                  if (e.button === 1) {
                    e.preventDefault()
                    handleBoardOpenInNewTab(board.id)
                  }
                }}>
                <span className="boards-item-name">{board.name}</span>
                <span className="boards-item-path">{board.path}</span>
              </button>
            )}
            {editingBoardId !== board.id && (
              <button
                type="button"
                className="boards-item-pencil"
                onClick={e => handleEditStart(e, board)}
                title="Rename board">
                <Pencil size={10} />
              </button>
            )}
          </div>
        ))}
        {metaRefresh}
      </div>
    </div>
  )
}

export default BoardsPanel
