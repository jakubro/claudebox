/** Panel configuration data for icon strip buttons. */

import {
  Archive,
  Kanban as BoardIcon,
  Bookmark,
  Box,
  Command,
  HelpCircle,
  History,
  ListTodo,
  Plug,
  SquareKanban,
  Terminal,
  TrendingUp,
} from 'lucide-react'

const PANEL_CONFIGS = {
  sessions: { id: 'sessions', Icon: History, title: 'Sessions', shortcut: 'Alt+1' },
  todos: { id: 'todos', Icon: ListTodo, title: 'Todos', shortcut: 'Alt+2' },
  stash: { id: 'stash', Icon: Archive, title: 'Stash', shortcut: 'Alt+3' },
  tasks: { id: 'tasks', Icon: SquareKanban, title: 'Tasks', shortcut: 'Alt+4' },
  bookmarks: { id: 'bookmarks', Icon: Bookmark, title: 'Bookmarks', shortcut: 'Alt+5' },
  boards: { id: 'boards', Icon: BoardIcon, title: 'Boards', shortcut: 'Alt+6' },
  usage: { id: 'usage', Icon: TrendingUp, title: 'Usage', shortcut: 'Alt+7' },
  mcp: { id: 'mcp', Icon: Plug, title: 'MCP Servers', shortcut: 'Alt+8' },
  commands: { id: 'commands', Icon: Command, title: 'Skills', shortcut: 'Alt+9' },
  help: { id: 'help', Icon: HelpCircle, title: 'Help' },
  logs: { id: 'logs', Icon: Terminal, title: 'Logs', shortcut: 'Alt+0' },
  containers: { id: 'containers', Icon: Box, title: 'Containers' },
}

export default PANEL_CONFIGS

/** Panel IDs that open at wide-floating-preview dimensions (≥800px / 60% vw). */
export const WIDE_FLOATING_PANELS = new Set(['logs', 'containers'])
