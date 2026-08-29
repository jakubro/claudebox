/** Tab header with icon, title, and close button for dockview side panels. */

import {
  Archive,
  Kanban as BoardIcon,
  Bookmark,
  Command,
  HelpCircle,
  History,
  ListTodo,
  Plug,
  SquareKanban,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAppActions } from '../../../context/AppActionsContext'
import TabShell from './tab-shell'

const ICONS = {
  todos: ListTodo,
  stash: Archive,
  sessions: History,
  boards: BoardIcon,
  help: HelpCircle,
  mcp: Plug,
  usage: TrendingUp,
  tasks: SquareKanban,
  commands: Command,
  bookmarks: Bookmark,
}

/**
 * @param {Object} props
 * @param {Object} props.api - Dockview panel API object.
 */
export default function IconTab({ api }) {
  const { maximizeToggle, closePanel } = useAppActions()

  const Icon = ICONS[api.id]

  const [title, setTitle] = useState(api.title)

  useEffect(() => {
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

  return (
    <TabShell
      className="icon-tab icon-tab-closeable"
      isCloseable
      title={title}
      events={{
        onDoubleClick: handleDoubleClick,
        onMouseDown: handleMouseDown,
        onClose: handleClose,
      }}>
      {Icon && <Icon size={12} />}
    </TabShell>
  )
}
