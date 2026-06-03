/** Pure derivations for Turn — extracted from Turn.jsx, no React APIs. */

import { formatDuration, stripMarkdown } from '../../../../../utils/formatters'
import { extractSystemReminders } from '../components/tool-block/utils/toolResultFormatters'

/**
 * Compute earliest and latest event timestamps for a turn.
 *
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
    const text = stripMarkdown(firstTextBlock.event.content)
    const firstLine = text.split('\n')[0]
    return firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine
  }
  const toolCount = blocks.filter(b => b.type === 'tool').length
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
