/** Tool result formatters - result extraction, header building, status, and display logic. */

import { SdkProtocol, TaskOutputStatus } from '../../../../../../../config/schema'
import { getToolConfig, TOOL_REGISTRY } from '../../../../../../../config/toolRegistry'
import { generateDiff } from '../../../../../../../utils/diff'
import { isInteractiveTool } from '../../../../../../../utils/eventPredicates'
import { formatFilePath } from '../../../../../../../utils/formatters'
import { parsePersistedOutput } from '../../../../../../../utils/parsers'

// ####################################################################################################
// Public API - consumed by ToolBlock, ToolBlockHeader, useToolResult, index barrel
// ####################################################################################################

/** Get tool status for bullet styling. */
export function getToolStatus(isPending, isAwaitingAnswer, isError) {
  if (isPending || isAwaitingAnswer) {
    return 'pending'
  }
  if (isError) {
    return 'error'
  }
  return 'completed'
}

/** Get summary text to display in tool result line. */
export function getSummaryText(
  toolName,
  isPending,
  isAwaitingAnswer,
  wasAnswered,
  summary,
  _isError,
  wasSkipped = false,
  answerLabel = null,
) {
  if (isPending) {
    return ''
  }
  const isInteractive = isInteractiveTool(toolName)
  if (isInteractive && wasSkipped) {
    return 'Skipped'
  }
  if (isAwaitingAnswer) {
    return 'Awaiting response...'
  }
  if (isInteractive && wasAnswered) {
    return answerLabel || 'Answered'
  }
  return summary
}

/** Determine if tool block should be collapsed by default. */
export function shouldCollapseByDefault(
  toolName,
  jsonData,
  hasNested,
  isPending,
  wasAnswered = false,
) {
  const config = getToolConfig(toolName)
  const collapse = config.collapseByDefault

  // Function-based collapse: tool has full control (interactive tools use this)
  if (typeof collapse === 'function') {
    return collapse({ jsonData, hasNested, isPending, wasAnswered })
  }

  // Cross-cutting rules (apply when tool uses static boolean)
  if (jsonData) {
    return true
  }
  if (hasNested && !isPending) {
    return true
  }

  return !!collapse
}

/**
 * Extract summary from tool result content.
 * @param {string} toolName - Name of the tool.
 * @param {object} input - Tool input args.
 * @param {string} resultContent - Raw result content.
 * @param {object} options - Optional context (e.g., todoDiff for TodoWrite).
 * @returns {{ summary: string, isError: boolean, details: string|null }}
 */
export function extractToolResult(toolName, input, resultContent, options = {}) {
  // Extract system reminders from content first (applies to all tools)
  const { content: rawCleaned, reminders } = extractSystemReminders(resultContent)
  const systemReminders = reminders.length > 0 ? reminders : null

  // Strip SDK pagination metadata if it appears as the final line
  const cleanedContent = rawCleaned.replace(SdkProtocol.PAGINATION_PATTERN, '')

  // Check for error - CSS handles truncation via ellipsis
  const errorMatch = cleanedContent.match(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/)
  if (errorMatch) {
    const errorText = errorMatch[1].trim()
    const isMultiline = errorText.includes('\n')
    return {
      summary: errorText,
      isError: true,
      // Only show details block for multi-line errors (avoids duplication)
      details: isMultiline ? errorText : null,
      systemReminders,
    }
  }

  const config = getToolConfig(toolName)
  const formatter = config.formatter ?? defaultFormatter

  // Check for persisted output wrapper - process preview like normal content
  const persisted = parsePersistedOutput(cleanedContent)
  if (persisted) {
    const previewContent = persisted.preview || ''
    const result = formatter(input, previewContent, options)
    return {
      ...result,
      persistedOutput: { fileSize: persisted.fileSize, previewSize: persisted.previewSize },
      systemReminders: result.systemReminders || systemReminders,
    }
  }

  // Tool-specific formatters
  const result = formatter(input, cleanedContent, options)

  // Merge reminders (don't override if formatter already set them)
  return {
    ...result,
    systemReminders: result.systemReminders || systemReminders,
  }
}

/** Format tool header with args via tool-specific formatters. */
export function buildToolHeader(toolName, input, isExpanded = false) {
  const config = getToolConfig(toolName)
  const formatter = config.headerFormatter ?? defaultHeaderFormatter
  return formatter(toolName, input, isExpanded)
}

/** Get full tooltip content for tool header hover. */
export function getToolTooltip(toolName, input) {
  const config = getToolConfig(toolName)
  if (config.tooltip) {
    return config.tooltip(input)
  }
  // Default: first string param
  const keys = Object.keys(input || {})
  if (keys.length === 0) {
    return null
  }
  const firstVal = input[keys[0]]
  return typeof firstVal === 'string' ? firstVal : null
}

/**
 * Extract system reminders from content.
 * Returns { content: cleanedContent, reminders: string[] }
 */
export function extractSystemReminders(content) {
  const reminders = []
  const pattern = /<system-reminder>([\s\S]*?)<\/system-reminder>/g
  let match
  while ((match = pattern.exec(content)) !== null) {
    reminders.push(match[1].trim())
  }
  const cleanedContent = content.replace(pattern, '').replace(/^\n+|\n+$/g, '')
  return { content: cleanedContent, reminders }
}

/** Check whether a tool has a specialized result formatter. */
export function hasSpecializedFormatter(toolName) {
  const entry = TOOL_REGISTRY[toolName]
  return entry != null && entry.formatter != null
}

/** Generate human-readable summary from parsed JSON data. */
export function generateJsonSummary(parsed) {
  if (Array.isArray(parsed)) {
    // If array of {type: "text", text: "..."}, extract first text
    // CSS handles truncation via ellipsis
    if (parsed[0]?.type === 'text' && parsed[0]?.text) {
      return parsed[0].text
    }
    return `${parsed.length} item${parsed.length !== 1 ? 's' : ''}`
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const keys = Object.keys(parsed)
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`
  }
  return 'JSON data'
}

// ####################################################################################################
// Result formatters - exported for toolRegistry.js
// ####################################################################################################

/** Extract Read tool result summary. */
export function formatReadResult(input, content) {
  // Count lines (format: "     1->content")
  const lines = content.split('\n').filter(l => /^\s*\d+[\u2192\u2502\t]/.test(l))
  const lineCount = lines.length

  if (lineCount > 0) {
    return {
      summary: `Read ${lineCount} lines`,
      isError: false,
      details: content,
    }
  }

  // Might be a warning or short file
  if (content.includes('Warning:')) {
    const warning = content.match(/Warning:\s*([^\n]+)/)?.[1] || 'Warning'
    return {
      summary: warning,
      isError: false,
      details: content,
    }
  }

  return defaultFormatter(input, content)
}

/** Extract Edit tool result summary with diff generation. */
export function formatEditResult(input, content) {
  if (content.includes('has been updated') && input?.old_string && input?.new_string) {
    const diff = generateDiff(input.old_string, input.new_string)
    return {
      summary: diff.summary,
      isError: false,
      details: diff.formatted,
    }
  }
  return defaultFormatter(input, content)
}

/** Extract Write tool result summary with line-numbered content. */
export function formatWriteResult(input, content) {
  if (input?.content && !content.includes('<tool_use_error>')) {
    const lines = input.content.split('\n')
    const lineCount = lines.length
    const formatted = formatWithLineNumbers(input.content)
    return {
      summary: `Wrote ${lineCount} lines`,
      isError: false,
      details: formatted,
      isWriteContent: true,
    }
  }
  return defaultFormatter(input, content)
}

/** Extract Bash tool result summary with ANSI stripping. */
export function formatBashResult(_input, content) {
  const text = extractTextFromJsonArray(content) ?? content
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping
  const cleaned = text.replace(/\u001b\[[0-9;]*m/g, '')
  const lines = cleaned.split('\n')
  const lineCount = lines.length
  const preview = lines[0] || ''

  return {
    summary: lineCount > 1 ? `${lineCount} lines output` : preview || 'Done',
    isError: false,
    details: cleaned,
  }
}

/** Extract Grep tool result summary with mode-aware counting. */
export function formatGrepResult(input, content) {
  if (content === 'No matches found') {
    return { summary: 'No matches', isError: false, details: null }
  }

  const lines = content.split('\n').filter(Boolean)
  const mode = input?.output_mode || 'files_with_matches'

  let count, label

  if (mode === 'content') {
    count = lines.filter(l => /^.+?:\d+:/.test(l) || /^\d+:/.test(l)).length
    label = count === 1 ? 'match' : 'matches'
  } else if (mode === 'count') {
    count = lines.filter(l => !l.startsWith('Found ')).length
    label = count === 1 ? 'file with matches' : 'files with matches'
  } else {
    count = lines.filter(l => !l.startsWith('Found ')).length
    label = count === 1 ? 'file' : 'files'
  }

  return {
    summary: `${count} ${label}`,
    isError: false,
    details: content,
  }
}

/** Extract Glob tool result summary. */
export function formatGlobResult(_input, content) {
  if (content.includes('No files found')) {
    return { summary: 'No files found', isError: false, details: null }
  }
  const files = content.split('\n').filter(Boolean)
  return {
    summary: `${files.length} files`,
    isError: false,
    details: content,
  }
}

/** Extract Task tool result summary from text or JSON array. */
export function formatTaskResult(input, content) {
  // Async/background task detection lives in ToolBlock.jsx and reads structured
  // tool_use_result data; this formatter handles only the plain-text fallback.
  const trimmed = content.trim()
  const taskPrompt = input?.prompt || null

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed[0]?.type === 'text' && parsed[0]?.text) {
        const textParts = parsed
          .filter(p => p.type === 'text' && !p.text.startsWith('agentId:'))
          .map(p => p.text)
        const fullText = textParts.join('\n')
        const firstLine = fullText.split('\n')[0] || 'Completed'
        return {
          summary: firstLine,
          isError: false,
          details: fullText.length > firstLine.length ? fullText : null,
          taskPrompt,
        }
      }
    } catch (_e) {
      // ignore
    }
  }
  const firstLine = content.split('\n')[0] || 'Completed'
  return {
    summary: firstLine,
    isError: false,
    details: content.length > firstLine.length ? content : null,
    taskPrompt,
  }
}

/** Extract TodoWrite tool result summary from diff counts. */
export function formatTodoWriteResult(input, _content, options = {}) {
  const todos = input?.todos || []
  const { todoDiff } = options

  // Build summary from diff counts (completed/started/added/removed)
  // Uses icons: ● completed, ◐ in_progress, ○ pending, ✕ removed
  const parts = []
  if (todoDiff) {
    const completedCount = todoDiff.completed?.length || 0
    const startedCount = todoDiff.started?.length || 0
    const addedCount = todoDiff.added?.length || 0
    const removedCount = todoDiff.removed?.length || 0

    if (completedCount > 0) {
      parts.push(`●${completedCount}`)
    }
    if (startedCount > 0) {
      parts.push(`◐${startedCount}`)
    }
    if (addedCount > 0) {
      parts.push(`○${addedCount}`)
    }
    if (removedCount > 0) {
      parts.push(`✕${removedCount}`)
    }
  } else {
    const count = todos.length
    if (count > 0) {
      parts.push(`○${count}`)
    }
  }
  const summary = parts.length > 0 ? parts.join(' ') : 'No changes'

  return { summary, isError: false, details: null, todoData: todos }
}

/** Extract MCPSearch tool result summary. */
export function formatMcpSearchResult(input, content) {
  if (content.includes('Selected tool')) {
    return { summary: 'Tool loaded', isError: false, details: content }
  }
  const matches = content.match(/Found (\d+)/)
  if (matches) {
    return { summary: `Found ${matches[1]} tools`, isError: false, details: content }
  }
  return defaultFormatter(input, content)
}

/** Extract Skill tool result summary. */
export function formatSkillResult(input, content) {
  const skill = input?.skill || 'skill'
  return { summary: `Launching skill: ${skill}`, isError: false, details: content }
}

/** Extract AskUserQuestion tool result summary. */
export function formatAskUserQuestionResult(input, content) {
  const count = input?.questions?.length || 0
  return {
    summary: content?.includes('answers')
      ? 'Answered'
      : `${count} question${count !== 1 ? 's' : ''}`,
    isError: false,
    details: null,
    questions: input?.questions,
  }
}

/** Extract ExitPlanMode tool result summary. */
export function formatExitPlanModeResult(input, _content) {
  return {
    summary: 'Exit plan mode?',
    isError: false,
    details: null,
    plan: input?.plan,
  }
}

/** Extract TaskOutput tool result summary from XML status tags. */
export function formatTaskOutputResult(_input, content) {
  const extractTag = tag => {
    const match = content.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
    return match?.[1]?.trim() || null
  }

  const retrievalStatus = extractTag('retrieval_status')
  const status = extractTag('status')

  const isTimeout = retrievalStatus === TaskOutputStatus.TIMEOUT
  const isFailed = retrievalStatus === TaskOutputStatus.FAILED || status === TaskOutputStatus.FAILED
  const isKilled = status === TaskOutputStatus.KILLED
  const isRunning =
    !isTimeout &&
    (retrievalStatus === TaskOutputStatus.NOT_READY || status === TaskOutputStatus.RUNNING)

  let summary = 'Completed'
  if (isTimeout) {
    summary = 'Timeout'
  } else if (isFailed) {
    summary = 'Failed'
  } else if (isKilled) {
    summary = 'Killed'
  } else if (isRunning) {
    summary = 'Running'
  }

  return {
    summary,
    isError: isFailed,
    details: null,
    isTaskOutputRunning: isRunning,
    isTaskOutputKilled: isKilled,
  }
}

// ####################################################################################################
// Header formatters - exported for toolRegistry.js (CSS handles overflow ellipsis)
// ####################################################################################################

/** Format Read tool header with file path. */
export function formatReadHeader(name, input, isExpanded) {
  const path = formatFilePath(input?.file_path, isExpanded)
  return `${name}(${path})`
}

/** Format Edit tool header with file path. */
export function formatEditHeader(name, input, isExpanded) {
  const path = formatFilePath(input?.file_path, isExpanded)
  return `${name}(${path})`
}

/** Format Write tool header with file path. */
export function formatWriteHeader(name, input, isExpanded) {
  const path = formatFilePath(input?.file_path, isExpanded)
  return `${name}(${path})`
}

/** Format Bash tool header with command. */
export function formatBashHeader(name, input) {
  const cmd = input?.command || 'command'
  return `${name}(${cmd})`
}

/** Format Grep tool header with pattern and optional path. */
export function formatGrepHeader(name, input, isExpanded) {
  const pattern = input?.pattern || 'pattern'
  const path = input?.path
  if (path) {
    const displayPath = isExpanded ? path : path.split('/').filter(Boolean).pop() || path
    return `${name}(${pattern}:${displayPath})`
  }
  return `${name}(${pattern})`
}

/** Format Glob tool header with pattern. */
export function formatGlobHeader(name, input) {
  const pattern = input?.pattern || 'pattern'
  return `${name}(${pattern})`
}

/** Format Task tool header with description or prompt. */
export function formatTaskHeader(name, input) {
  const desc = input?.description || input?.prompt || 'task'
  return `${name}(${desc})`
}

/** Format WebFetch tool header with URL (protocol stripped). */
export function formatWebFetchHeader(name, input) {
  const url = input?.url?.replace(/^https?:\/\//, '') || 'url'
  return `${name}(${url})`
}

/** Format WebSearch tool header with query. */
export function formatWebSearchHeader(name, input) {
  const query = input?.query || 'query'
  return `${name}(${query})`
}

/** Format Skill tool header with skill name. */
export function formatSkillHeader(name, input) {
  const skill = input?.skill || 'skill'
  return `${name}(${skill})`
}

/** Format AskUserQuestion tool header with question count. */
export function formatAskUserQuestionHeader(name, input) {
  const count = input?.questions?.length || 0
  return `${name}(${count} question${count !== 1 ? 's' : ''})`
}

/** Format ExitPlanMode tool header with plan title. */
export function formatExitPlanModeHeader(name, input) {
  const plan = input?.plan || ''
  const titleMatch = plan.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1] : 'Plan'
  return `${name}(${title})`
}

/** Format TaskOutput tool header with task ID. */
export function formatTaskOutputHeader(name, input) {
  const taskId = input?.task_id || 'task'
  return `${name}(${taskId})`
}

/** Default header formatter - show first string arg. */
export function defaultHeaderFormatter(name, input) {
  const keys = Object.keys(input || {})
  if (keys.length === 0) {
    return name
  }
  const firstVal = input[keys[0]]
  if (typeof firstVal === 'string') {
    return `${name}(${firstVal})`
  }
  return name
}

/** Default result formatter - parse JSON or show text preview. */
export function defaultFormatter(_input, content) {
  const trimmed = content.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      return {
        summary: generateJsonSummary(parsed),
        isError: false,
        details: null,
        jsonData: parsed,
      }
    } catch (_e) {
      // ignore
    }
  }

  const lines = content.split('\n')
  const preview = lines[0] || 'Done'
  return {
    summary: preview,
    isError: false,
    details: content,
  }
}

// Private helpers
// ####################################################################################################

/** Extract text from JSON array format: [{"type": "text", "text": "..."}] */
function extractTextFromJsonArray(content) {
  const trimmed = content.trim()
  if (!trimmed.startsWith('[')) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed[0]?.type === 'text' && parsed[0]?.text) {
      return parsed.map(p => p.text).join('\n')
    }
  } catch (_e) {
    // ignore
  }
  return null
}

/** Format content with line numbers like Read tool output. */
function formatWithLineNumbers(content) {
  const lines = content.split('\n')
  const maxLineNum = lines.length
  const width = String(maxLineNum).length
  return lines
    .map((line, i) => {
      const lineNum = String(i + 1).padStart(width, ' ')
      return `${lineNum}\u2192${line}`
    })
    .join('\n')
}
