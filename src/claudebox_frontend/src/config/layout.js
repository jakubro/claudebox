/** Static layout configuration - panel registry, sides, and canonical ordering. */

import IconTab from '../features/app/components/IconTab'
import MainPanel from '../features/app/components/MainPanel'
import withPanelBoundary from '../features/app/components/withPanelBoundary'
import BoardsPanel from '../features/boards'
import BookmarksPanel from '../features/bookmarks'
import ContainersPanel from '../features/containers'
import HelpPanel from '../features/help'
import LogsPanel from '../features/logs'
import McpPanel from '../features/mcp'
import SessionsPanel from '../features/sessions'
import SkillsPanel from '../features/skills'
import StashPanel from '../features/stash'
import TasksPanel from '../features/tasks'
import TodosPanel from '../features/todos'
import UsagePanel from '../features/usage'
import { DEFAULT_PANEL_WIDTH } from './dimensions'

export const HELP_OVERLAY_KEY = '?'

// Each panel wraps in an ErrorBoundary: a render error shows a retryable fallback, not a full unmount.
export const components = {
  main: withPanelBoundary(MainPanel, 'main'),
  commands: withPanelBoundary(SkillsPanel, 'commands'),
  todos: withPanelBoundary(TodosPanel, 'todos'),
  stash: withPanelBoundary(StashPanel, 'stash'),
  mcp: withPanelBoundary(McpPanel, 'mcp'),
  tasks: withPanelBoundary(TasksPanel, 'tasks'),
  sessions: withPanelBoundary(SessionsPanel, 'sessions'),
  boards: withPanelBoundary(BoardsPanel, 'boards'),
  help: withPanelBoundary(HelpPanel, 'help'),
  usage: withPanelBoundary(UsagePanel, 'usage'),
  logs: withPanelBoundary(LogsPanel, 'logs'),
  bookmarks: withPanelBoundary(BookmarksPanel, 'bookmarks'),
  containers: withPanelBoundary(ContainersPanel, 'containers'),
}

export const tabComponents = {
  icon: IconTab,
}

// Side each panel belongs to. Logs is absent - it lives in the full-width strip, not a dockview side group.
export const PANEL_SIDES = {
  sessions: 'left',
  bookmarks: 'right',
  boards: 'right',
  todos: 'right',
  stash: 'right',
  mcp: 'right',
  tasks: 'right',
  usage: 'right',
  help: 'right',
  commands: 'right',
}

// Canonical order for panels (maintains consistent vertical ordering within each side)
export const CANONICAL_LEFT_ORDER = ['sessions']
export const CANONICAL_RIGHT_ORDER = [
  'todos',
  'stash',
  'tasks',
  'bookmarks',
  'boards',
  'usage',
  'mcp',
  'commands',
  'help',
]

export const SIDE_PANEL_CONFIG = {
  sides: PANEL_SIDES,
  canonicalOrder: {
    left: CANONICAL_LEFT_ORDER,
    right: CANONICAL_RIGHT_ORDER,
  },
  defaultWidth: DEFAULT_PANEL_WIDTH,
}
