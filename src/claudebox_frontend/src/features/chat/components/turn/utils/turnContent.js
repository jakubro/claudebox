/** Pure derivations for Turn - extracted from Turn.jsx, no React APIs. */

import { normalizeToolName, ToolName } from '../../../../../config/schema'
import { getToolConfig } from '../../../../../config/toolRegistry'
import {
  isHiddenInFocused,
  isHiddenToolSearch,
  isToolBlockVisible,
  NO_TOOL_MARKED,
  TurnRoutingMode,
} from '../../../../../utils/eventProcessing'
import { formatDuration, stripMarkdown } from '../../../../../utils/formatters'
import { extractSystemReminders } from '../../../../../utils/parsers'

const PREVIEW_MAX_LENGTH = 60
const CODE_FENCE_LINE = /^```/

/** Epoch-ms span of the events' `ts` values; both null when none carries one. */
export function getTurnTimeRange(events) {
  if (events.length === 0) {
    return { startTime: null, endTime: null }
  }
  const timestamps = events.map(e => (e.ts ? new Date(e.ts).getTime() : null)).filter(Boolean)
  if (timestamps.length === 0) {
    return { startTime: null, endTime: null }
  }
  return {
    startTime: Math.min(...timestamps),
    endTime: Math.max(...timestamps),
  }
}

/**
 * One-line preview for a collapsed turn; `duration` is in seconds.
 * `mode` excludes whatever it routes away - those blocks render in the right slot instead.
 */
export function getTurnPreview(
  blocks,
  duration,
  mode = TurnRoutingMode.OFF,
  bookmarkedParts = null,
  isMarked = NO_TOOL_MARKED,
) {
  const firstTextBlock = blocks.find(b => b.type === 'text')
  if (firstTextBlock) {
    const preview = previewFromTextBlock(firstTextBlock.event.content)
    if (preview) {
      return preview
    }
  }
  const toolCount = blocks.filter(
    b =>
      b.type === 'tool' &&
      isToolBlockVisible(mode, b.toolUse, b.toolResult, bookmarkedParts, isMarked),
  ).length
  if (toolCount > 0) {
    return `${toolCount} tool${toolCount > 1 ? 's' : ''} used`
  }
  const hasCompaction = blocks.some(b => b.type === 'compaction')
  if (hasCompaction) {
    return 'Conversation compacted'
  }
  if (duration !== null) {
    return `Worked for ${formatDuration(duration)}`
  }
  return null
}

/**
 * The working line's phrase for the turn's newest block when Focused hides it; null keeps `Working`.
 * A hidden tool-schema search, or a needs-you call that did not fail, never counts as newest.
 */
export function getProgressLabel(blocks, mode, bookmarkedParts = null, isMarked = NO_TOOL_MARKED) {
  if (mode !== TurnRoutingMode.FOCUSED) {
    return null
  }
  const newest = blocks.findLast(b => !isUncountedCall(b))
  if (
    newest?.type !== 'tool' ||
    !isHiddenInFocused(newest.toolUse, newest.toolResult, bookmarkedParts, isMarked)
  ) {
    return null
  }
  const name = newest.toolUse.content
  return getToolConfig(name).progressLabel?.(name, newest.toolUse.tool_input ?? {}) ?? null
}

/** The props a turn's own record supplies to `Turn`: its user message, the message's extras, and its events. */
export function turnRecordProps(turn) {
  return {
    userMessage: turn.userMessage,
    attachments: turn.attachments,
    inlineReplies: turn.inlineReplies,
    note: turn.note,
    userMessageTime: turn.userMessageTs,
    recordedDurationMs: turn.durationMs ?? null,
    events: turn.events,
    turnId: turn.turn_id,
  }
}

/** Text-block content joined for the copy button, with system reminders stripped. */
export function getAssistantTextContent(blocks) {
  return blocks
    .filter(b => b.type === 'text')
    .map(b => extractSystemReminders(b.event.content).content)
    .join('\n\n')
}

/** Return the turn's last text block that keeps any text once system reminders are stripped. */
export function getAnswerText(blocks) {
  return (
    blocks
      .filter(b => b.type === 'text')
      .map(b => extractSystemReminders(b.event.content).content)
      .findLast(content => content.trim()) ?? ''
  )
}

/** Falls back to the raw first line when stripMarkdown empties content (code fence, table). */
function previewFromTextBlock(content) {
  const strippedFirstLine = stripMarkdown(content).split('\n')[0]
  if (strippedFirstLine) {
    return truncatePreview(strippedFirstLine)
  }
  const rawFirstLine = firstMeaningfulLine(content)
  return rawFirstLine ? truncatePreview(rawFirstLine) : null
}

/** First line that is neither blank nor a bare code-fence delimiter. */
function firstMeaningfulLine(text) {
  const line = text.split('\n').find(l => l.trim() && !CODE_FENCE_LINE.test(l.trim()))
  return line ? line.trim() : null
}

function truncatePreview(line) {
  return line.length > PREVIEW_MAX_LENGTH ? `${line.slice(0, PREVIEW_MAX_LENGTH)}...` : line
}

function isUncountedCall(block) {
  return (
    block.type === 'tool' &&
    (isHiddenToolSearch(block.toolUse, block.toolResult) ||
      (normalizeToolName(block.toolUse?.content) === ToolName.NEEDS_USER &&
        !block.toolResult?.is_error))
  )
}
