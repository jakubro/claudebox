/** Pure derivations for Turn - extracted from Turn.jsx, no React APIs. */

import { isToolBlockVisible, TurnRoutingMode } from '../../../../../utils/eventProcessing'
import { formatDuration, stripMarkdown } from '../../../../../utils/formatters'
import { extractSystemReminders } from '../components/tool-block/utils/toolResultFormatters'

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
export function getTurnPreview(blocks, duration, mode = TurnRoutingMode.OFF) {
  const firstTextBlock = blocks.find(b => b.type === 'text')
  if (firstTextBlock) {
    const preview = previewFromTextBlock(firstTextBlock.event.content)
    if (preview) {
      return preview
    }
  }
  const toolCount = blocks.filter(
    b => b.type === 'tool' && isToolBlockVisible(mode, b.toolUse, b.toolResult),
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

/** Text-block content joined for the copy button, with system reminders stripped. */
export function getAssistantTextContent(blocks) {
  return blocks
    .filter(b => b.type === 'text')
    .map(b => extractSystemReminders(b.event.content).content)
    .join('\n\n')
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
