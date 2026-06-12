/** Static layout configuration - panel registry, sides, and canonical ordering. */

import IconTab from '../features/app/components/IconTab'
import MainPanel from '../features/app/components/MainPanel'
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
import { DEFAULT_PANEL_HEIGHT, DEFAULT_PANEL_WIDTH } from './dimensions'

export const HELP_OVERLAY_KEY = '?'

export const components = {
  main: MainPanel,
  commands: SkillsPanel,
  todos: TodosPanel,
  stash: StashPanel,
  mcp: McpPanel,
  tasks: TasksPanel,
  sessions: SessionsPanel,
  boards: BoardsPanel,
  help: HelpPanel,
  usage: UsagePanel,
  logs: LogsPanel,
  bookmarks: BookmarksPanel,
  containers: ContainersPanel,
}

export const tabComponents = {
  icon: IconTab,
}

// Track which side each panel belongs to. Logs is intentionally absent -
// it lives in the full-viewport-width strip below the main row, not in any
// dockview side group.
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
    // Empty - bottom-side machinery preserved for future bottom panels.
    bottom: [],
  },
  defaultWidth: DEFAULT_PANEL_WIDTH,
  defaultHeight: DEFAULT_PANEL_HEIGHT,
}
