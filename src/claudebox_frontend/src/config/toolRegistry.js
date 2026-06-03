/** Unified per-tool rendering configuration — single place to add new tools. */

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
import { ToolName } from './schema'

/**
 * Per-tool rendering configuration.
 *
 * Each entry defines how a tool's results are extracted, displayed,
 * collapsed, and copied. Adding a new tool = adding one entry here.
 *
 * Properties:
 * - formatter: (input, content, options?) => { summary, isError, details, ... } | null (use default)
 * - headerFormatter: (name, input, isExpanded?) => string | null (use default)
 * - collapseByDefault: boolean | ({ jsonData, hasNested, isPending, wasAnswered }) => boolean
 * - tooltip: (input) => string|null | null (use default first-string-param)
 * - renderer: 'syntax-or-code' | 'code' | 'markdown' | 'default'
 * - codeParser: 'readWrite' | 'grep' | 'edit' | null
 * - copyableExtractor: (details) => string | null (return details as-is)
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
  },
  [ToolName.WRITE]: {
    formatter: formatWriteResult,
    headerFormatter: formatWriteHeader,
    collapseByDefault: false,
    tooltip: input => input?.file_path || null,
    renderer: 'syntax-or-code',
    codeParser: 'readWrite',
    copyableExtractor: extractCodeFromReadOutput,
  },
  [ToolName.EDIT]: {
    formatter: formatEditResult,
    headerFormatter: formatEditHeader,
    collapseByDefault: false,
    tooltip: input => input?.file_path || null,
    renderer: 'code',
    codeParser: 'edit',
    copyableExtractor: extractEditCopyableText,
  },
  [ToolName.BASH]: {
    formatter: formatBashResult,
    headerFormatter: formatBashHeader,
    collapseByDefault: false,
    tooltip: input => input?.command || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
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
  },
  [ToolName.GLOB]: {
    formatter: formatGlobResult,
    headerFormatter: formatGlobHeader,
    collapseByDefault: false,
    tooltip: input => input?.file_path || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.TASK]: {
    formatter: formatTaskResult,
    headerFormatter: formatTaskHeader,
    collapseByDefault: false,
    tooltip: input => input?.prompt || null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.SKILL]: {
    formatter: formatSkillResult,
    headerFormatter: formatSkillHeader,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
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
  },
  [ToolName.EXIT_PLAN_MODE]: {
    formatter: formatExitPlanModeResult,
    headerFormatter: formatExitPlanModeHeader,
    collapseByDefault: () => false,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.TODO_WRITE]: {
    formatter: formatTodoWriteResult,
    headerFormatter: null,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.TASK_CREATE]: {
    formatter: formatTodoWriteResult,
    headerFormatter: null,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.TASK_UPDATE]: {
    formatter: formatTodoWriteResult,
    headerFormatter: null,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.TASK_OUTPUT]: {
    formatter: formatTaskOutputResult,
    headerFormatter: formatTaskOutputHeader,
    collapseByDefault: true,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.WEB_SEARCH]: {
    formatter: null,
    headerFormatter: formatWebSearchHeader,
    collapseByDefault: true,
    tooltip: input => input?.query || null,
    renderer: 'markdown',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.WEB_FETCH]: {
    formatter: null,
    headerFormatter: formatWebFetchHeader,
    collapseByDefault: true,
    tooltip: input => input?.url || null,
    renderer: 'markdown',
    codeParser: null,
    copyableExtractor: null,
  },
  [ToolName.MCP_SEARCH]: {
    formatter: formatMcpSearchResult,
    headerFormatter: null,
    collapseByDefault: false,
    tooltip: null,
    renderer: 'default',
    codeParser: null,
    copyableExtractor: null,
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
}

/** Look up tool config, falling back to defaults for unknown tools. */
export function getToolConfig(toolName) {
  return TOOL_REGISTRY[toolName] ?? DEFAULT_TOOL_CONFIG
}
