/** Pure derivations for Turn - extracted from Turn.jsx, no React APIs. */

import { isHiddenToolSearch } from '../../../../../utils/eventProcessing'
import { formatDuration, stripMarkdown } from '../../../../../utils/formatters'
import { extractSystemReminders } from '../components/tool-block/utils/toolResultFormatters'

const PREVIEW_MAX_LENGTH = 60
const CODE_FENCE_LINE = /^```/

/**
 * @param {Array<{ts?: string}>} events
 * @returns {{ startTime: number | null, endTime: number | null }}
 */
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
 * Build a one-line preview for a collapsed turn.
 *
 * @param {Array<{type: string, event?: object}>} blocks
 * @param {number | null} duration - Seconds
 * @returns {string | null}
 */
export function getTurnPreview(blocks, duration) {
  const firstTextBlock = blocks.find(b => b.type === 'text')
  if (firstTextBlock) {
    const preview = previewFromTextBlock(firstTextBlock.event.content)
    if (preview) {
      return preview
    }
  }
  const toolCount = blocks.filter(
    b => b.type === 'tool' && !isHiddenToolSearch(b.toolUse, b.toolResult),
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
 * Concatenate text-block content for the copy-button (system reminders stripped).
 *
 * @param {Array<{type: string, event?: object}>} blocks
 * @returns {string}
 */
export function getAssistantTextContent(blocks) {
  return blocks
    .filter(b => b.type === 'text')
    .map(b => extractSystemReminders(b.event.content).content)
    .join('\n\n')
}

/**
 * Falls back to the raw first line when stripMarkdown empties the content (e.g. it opens with a
 * code fence or table, which strips to nothing).
 *
 * @param {string} content
 * @returns {string | null}
 */
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
