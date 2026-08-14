/** Unified per-tool rendering configuration - single place to add new tools. */

import {
  extractCodeFromReadOutput,
  extractEditCopyableText,
} from '../features/chat/components/turn/components/tool-block/components/tool-block-expanded-content/components/tool-content-renderer/utils/copyableText'
import {
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
} from '../features/chat/components/turn/components/tool-block/utils/toolResultFormatters'
import { normalizeToolName, ToolName } from './schema'

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
  },
  [ToolName.BASH]: {
    formatter: formatBashResult,
    headerFormatter: formatBashHeader,
    collapseByDefault: false,
    tooltip: input => input?.command || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    // Bash(ls) vs Bash(rm -rf) look alike unparsed, so Bash is never read-only.
    category: 'default',
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
  },
  [ToolName.TASK]: {
    formatter: formatTaskResult,
    headerFormatter: formatTaskHeader,
    collapseByDefault: false,
    tooltip: input => input?.prompt || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
    category: 'default',
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
  },
  [ToolName.WEB_FETCH]: {
    formatter: null,
    headerFormatter: formatWebFetchHeader,
    collapseByDefault: true,
    tooltip: input => input?.url || null,
    renderer: 'markdown',
    codeParser: null,
    copyableExtractor: null,
    category: 'read-only',
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
  },
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
}

/** Falls back to defaults for unknown tools; normalises the name first so LangGraph snake_case aliases resolve to their Claude PascalCase equivalents. */
export function getToolConfig(toolName) {
  return TOOL_REGISTRY[normalizeToolName(toolName)] ?? DEFAULT_TOOL_CONFIG
}
