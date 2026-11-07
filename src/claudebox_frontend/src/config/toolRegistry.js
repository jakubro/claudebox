/** Unified per-tool rendering configuration - single place to add new tools. */

import {
  extractCodeFromReadOutput,
  extractEditCopyableText,
} from '../features/chat/components/turn/components/tool-block/components/tool-block-expanded-content/components/tool-content-renderer/utils/copyableText'
import {
  bashProgressLabel,
  defaultFormatter,
  defaultHeaderFormatter,
  formatAskUserQuestionHeader,
  formatAskUserQuestionResult,
  formatBashHeader,
  formatBashResult,
  formatEditHeader,
  formatEditResult,
  formatExitPlanModeHeader,
  formatExitPlanModeResult,
  formatGlobHeader,
  formatGlobResult,
  formatGrepHeader,
  formatGrepResult,
  formatMcpSearchResult,
  formatReadHeader,
  formatReadResult,
  formatSkillHeader,
  formatSkillResult,
  formatTaskHeader,
  formatTaskOutputHeader,
  formatTaskOutputResult,
  formatTaskResult,
  formatTodoWriteResult,
  formatWebFetchHeader,
  formatWebSearchHeader,
  formatWriteHeader,
  formatWriteResult,
  readProgressLabel,
  searchProgressLabel,
  skillProgressLabel,
  toolServerProgressLabel,
  webFetchProgressLabel,
  webSearchProgressLabel,
} from '../features/chat/components/turn/components/tool-block/utils/toolResultFormatters'
import { normalizeToolName, ToolName } from './schema'

const MCP_RESOURCE_TOOL_CONFIG = {
  formatter: null,
  headerFormatter: null,
  collapseByDefault: false,
  tooltip: null,
  renderer: 'default',
  codeParser: null,
  copyableExtractor: null,
  category: 'default',
  progressLabel: null,
}

/**
 * Properties:
 * - formatter: (input, content, options?) => { summary, isError, details, ... } | null (use default)
 * - headerFormatter: (name, input, isExpanded?) => string | null (use default)
 * - collapseByDefault: boolean | ({ jsonData, hasNested, isPending, wasAnswered }) => boolean
 * - tooltip: (input) => string|null | null (use default first-string-param)
 * - renderer: 'syntax-or-code' | 'code' | 'markdown' | 'default'
 * - codeParser: 'readWrite' | 'grep' | 'edit' | null
 * - copyableExtractor: (details) => string | null (return details as-is)
 * - category: 'read-only' | 'default' - read-only calls gather into the turn's Lookups panel
 * - progressLabel: (name, input) => string | null - the working line's phrase while the call is
 *   hidden and newest; null keeps 'Working'
 */
export const TOOL_REGISTRY = {
  [ToolName.READ]: {
    formatter: formatReadResult,
    headerFormatter: formatReadHeader,
    collapseByDefault: true,
    tooltip: input => input?.file_path || null,
    renderer: 'syntax-or-code',
    codeParser: 'readWrite',
    copyableExtractor: extractCodeFromReadOutput,
    category: 'read-only',
    progressLabel: readProgressLabel,
  },
  [ToolName.WRITE]: {
    formatter: formatWriteResult,
    headerFormatter: formatWriteHeader,
    collapseByDefault: false,
    tooltip: input => input?.file_path || null,
    renderer: 'syntax-or-code',
    codeParser: 'readWrite',
    copyableExtractor: extractCodeFromReadOutput,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.EDIT]: {
    formatter: formatEditResult,
    headerFormatter: formatEditHeader,
    collapseByDefault: false,
    tooltip: input => input?.file_path || null,
    renderer: 'code',
    codeParser: 'edit',
    copyableExtractor: extractEditCopyableText,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.BASH]: {
    formatter: formatBashResult,
    headerFormatter: formatBashHeader,
    collapseByDefault: false,
    tooltip: input => input?.command || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    // Read-only per call, never by name: isReadOnlyCall reads what the backend marked or measured.
    category: 'default',
    progressLabel: bashProgressLabel,
  },
  [ToolName.GREP]: {
    formatter: formatGrepResult,
    headerFormatter: formatGrepHeader,
    collapseByDefault: true,
    tooltip: input => {
      const parts = []
      if (input?.pattern) {
        parts.push(input.pattern)
      }
      if (input?.path) {
        parts.push(input.path)
      }
      return parts.length > 0 ? parts.join('\n') : null
    },
    renderer: 'code',
    codeParser: 'grep',
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: searchProgressLabel,
  },
  [ToolName.GLOB]: {
    formatter: formatGlobResult,
    headerFormatter: formatGlobHeader,
    collapseByDefault: false,
    tooltip: input => input?.file_path || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: searchProgressLabel,
  },
  [ToolName.TASK]: {
    formatter: formatTaskResult,
    headerFormatter: formatTaskHeader,
    collapseByDefault: true,
    tooltip: input => input?.prompt || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.SKILL]: {
    formatter: formatSkillResult,
    headerFormatter: formatSkillHeader,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
    progressLabel: skillProgressLabel,
  },
  [ToolName.ASK_USER_QUESTION]: {
    formatter: formatAskUserQuestionResult,
    headerFormatter: formatAskUserQuestionHeader,
    collapseByDefault: ({ wasAnswered }) => !!wasAnswered,
    tooltip: input => {
      const questions = input?.questions?.map(q => q.question).filter(Boolean)
      return questions?.length > 0 ? questions.join('\n') : null
    },
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.EXIT_PLAN_MODE]: {
    formatter: formatExitPlanModeResult,
    headerFormatter: formatExitPlanModeHeader,
    collapseByDefault: () => false,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.TODO_WRITE]: {
    formatter: formatTodoWriteResult,
    headerFormatter: null,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.TASK_CREATE]: {
    formatter: formatTodoWriteResult,
    headerFormatter: null,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.TASK_UPDATE]: {
    formatter: formatTodoWriteResult,
    headerFormatter: null,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
    progressLabel: null,
  },
  [ToolName.TASK_LIST]: {
    formatter: defaultFormatter,
    headerFormatter: defaultHeaderFormatter,
    collapseByDefault: false,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: null,
  },
  [ToolName.TASK_GET]: {
    formatter: defaultFormatter,
    headerFormatter: defaultHeaderFormatter,
    collapseByDefault: false,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: null,
  },
  [ToolName.TASK_OUTPUT]: {
    formatter: formatTaskOutputResult,
    headerFormatter: formatTaskOutputHeader,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: null,
  },
  [ToolName.WEB_SEARCH]: {
    formatter: null,
    headerFormatter: formatWebSearchHeader,
    collapseByDefault: true,
    tooltip: input => input?.query || null,
    renderer: 'markdown',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: webSearchProgressLabel,
  },
  [ToolName.WEB_FETCH]: {
    formatter: null,
    headerFormatter: formatWebFetchHeader,
    collapseByDefault: true,
    tooltip: input => (typeof input?.url === 'string' && input.url) || null,
    renderer: 'markdown',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: webFetchProgressLabel,
  },
  [ToolName.MCP_SEARCH]: {
    formatter: formatMcpSearchResult,
    headerFormatter: null,
    collapseByDefault: false,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
    progressLabel: null,
  },
  [ToolName.LIST_MCP_RESOURCES]: MCP_RESOURCE_TOOL_CONFIG,
  [ToolName.READ_MCP_RESOURCE]: MCP_RESOURCE_TOOL_CONFIG,
  [ToolName.READ_MCP_RESOURCE_DIR]: MCP_RESOURCE_TOOL_CONFIG,
}

const DEFAULT_TOOL_CONFIG = {
  formatter: defaultFormatter,
  headerFormatter: defaultHeaderFormatter,
  collapseByDefault: false,
  tooltip: null,
  renderer: 'default',
  codeParser: null,
  copyableExtractor: null,
  category: 'default',
  progressLabel: toolServerProgressLabel,
}

/** Falls back to defaults for unknown tools; normalises the name first so LangGraph snake_case aliases resolve to their Claude PascalCase equivalents. */
export function getToolConfig(toolName) {
  return TOOL_REGISTRY[normalizeToolName(toolName)] ?? DEFAULT_TOOL_CONFIG
}

/** Normalised names of the tools the Focused view hides by name alone. */
export const FOCUSED_HIDDEN_TOOLS = new Set([
  ...Object.keys(TOOL_REGISTRY).filter(name => TOOL_REGISTRY[name].category === 'read-only'),
  ToolName.SKILL,
  ToolName.NEEDS_USER,
  ToolName.SESSION_READ,
  ToolName.SESSION_LIST,
  ToolName.LIST_MCP_RESOURCES,
  ToolName.READ_MCP_RESOURCE,
  ToolName.READ_MCP_RESOURCE_DIR,
])

/** Whether a call only reads: its tool's category, or a Bash call that changes nothing. */
export function isReadOnlyCall(toolUse, toolResult) {
  return (
    getToolConfig(toolUse?.content).category === 'read-only' ||
    isReadOnlyCommand(toolUse, toolResult)
  )
}

/** Whether a Bash call changes nothing: as measured once it finished, as read until then. */
export function isReadOnlyCommand(toolUse, toolResult) {
  if (typeof toolResult?.command_changed === 'boolean') {
    return !toolResult.command_changed
  }
  return toolUse?.command_read_only === true
}
