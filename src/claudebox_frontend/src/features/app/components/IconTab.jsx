/** Tab header with icon, title, and close button for dockview side and file panels. */

import {
  Archive,
  Kanban as BoardIcon,
  Bookmark,
  Command,
  FileText,
  FolderTree,
  HelpCircle,
  History,
  ListTodo,
  Plug,
  SquareKanban,
  Terminal,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { renameBoard } from '../../../api/boards'
import { useAppActions } from '../../../context/AppActionsContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { openBoardInNewTab } from '../../../utils/navigation'
import TabShell from './tab-shell'

const ICONS = {
  todos: ListTodo,
  stash: Archive,
  sessions: History,
  boards: BoardIcon,
  files: FolderTree,
  help: HelpCircle,
  mcp: Plug,
  usage: TrendingUp,
  tasks: SquareKanban,
  logs: Terminal,
  commands: Command,
  bookmarks: Bookmark,
}

/**
 * Render a panel tab with icon, title, and close button.
 * @param {Object} props
 * @param {Object} props.api - Dockview panel API object.
 */
export default function IconTab({ api }) {
  const { maximizeToggle, closePanel } = useAppActions()
  const { workspaceId } = useWorkspace()

  // File editor tabs start with "file:", board tabs start with "board:"
  const isFileTab = api.id.startsWith('file:')
  const isBoardTab = api.id.startsWith('board:')
  const boardId = isBoardTab ? api.id.replace('board:', '') : null
  const Icon = isFileTab ? FileText : isBoardTab ? BoardIcon : ICONS[api.id]

  // Track title in state to trigger re-render when it changes
  const [title, setTitle] = useState(api.title)

  useEffect(() => {
    // Subscribe to title changes
    const disposable = api.onDidTitleChange(() => {
      setTitle(api.title)
    })
    return () => disposable.dispose()
  }, [api])

  const handleDoubleClick = e => {
    e.stopPropagation()
    const groupApi = api.group?.api
    if (!groupApi) {
      return
    }
    maximizeToggle?.(groupApi)
  }

  const handleMouseDown = e => {
    // Middle-click (button 1) closes the tab
    if (e.button === 1) {
      e.preventDefault()
      e.stopPropagation()
      closePanel?.(api.id)
    }
  }

  const handleClose = useCallback(
    e => {
      e.stopPropagation()
      closePanel?.(api.id)
    },
    [api.id, closePanel],
  )

  const handleRenameSave = useCallback(
    async newName => {
      if (!(newName && boardId)) {
        return
      }
      try {
        await renameBoard(boardId, newName)
        api.setTitle(newName)
      } catch {
        // Rename failed silently
      }
    },
    [boardId, api],
  )

  const handleMoveToNewTab = useCallback(() => {
    if (workspaceId && boardId) {
      openBoardInNewTab(workspaceId, boardId)
      closePanel?.(api.id)
    }
  }, [workspaceId, boardId, api.id, closePanel])

  const getContextMenuItems = isBoardTab
    ? ({ startRename, closeContextMenu }) => [
        { label: 'Rename', onClick: startRename },
        {
          label: 'Close',
          onClick: () => {
            closeContextMenu()
            closePanel?.(api.id)
          },
        },
        { separator: true },
        {
          label: 'Move to new browser tab',
          onClick: () => {
            closeContextMenu()
            handleMoveToNewTab()
          },
        },
      ]
    : undefined

  return (
    <TabShell
      className="icon-tab icon-tab-closeable"
      isCloseable
      title={title}
      events={{
        onDoubleClick: handleDoubleClick,
        onMouseDown: handleMouseDown,
        onClose: handleClose,
      }}
      getContextMenuItems={getContextMenuItems}
      onRenameSave={isBoardTab ? handleRenameSave : undefined}>
      {Icon && <Icon size={12} />}
    </TabShell>
  )
}
