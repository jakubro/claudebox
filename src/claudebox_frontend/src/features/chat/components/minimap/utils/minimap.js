/** Pure functions for minimap segment building and normalization. */

import { MINIMAP_MAX_WIDTH, MINIMAP_MIN_WIDTH } from '../../../../../config/dimensions'
import { EventSubtype } from '../../../../../config/schema'

/**
 * Build segments from groups (turns grouped by compaction boundaries).
 *
 * A segment contains all turns until a compact_boundary event appears.
 * The turn with compact_boundary starts a new segment.
 */
export function buildSegments(groups, turnHeights, userMessageHeights = {}) {
  const segments = []
  let currentSegment = { turns: [], index: 0 }

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const hasCompaction = group.events?.some(e => e.subtype === EventSubtype.COMPACT_BOUNDARY)

    // If this turn has compaction, start new segment BEFORE adding this turn
    if (hasCompaction && currentSegment.turns.length > 0) {
      segments.push(currentSegment)
      currentSegment = { turns: [], index: segments.length }
    }

    const totalHeight = turnHeights[i] ?? 100
    const userHeight = userMessageHeights[i] ?? 0
    const userHeightPct = totalHeight > 0 ? Math.round((userHeight / totalHeight) * 100) : 0

    const duration = calculateDuration(group.events)
    currentSegment.turns.push({
      turnId: group.turn_id,
      groupIndex: i,
      hasUserMessage: !!group.userMessage,
      duration,
      height: totalHeight,
      userHeightPct,
    })
  }

  // Push final segment if non-empty
  if (currentSegment.turns.length > 0) {
    segments.push(currentSegment)
  }

  return segments
}

/**
 * Normalize durations to width values within MINIMAP_MIN_WIDTH to MINIMAP_MAX_WIDTH range.
 */
export function normalizeWidths(segments) {
  // Collect all durations
  const allDurations = segments.flatMap(s => s.turns.map(t => t.duration))
  const maxDuration = Math.max(...allDurations, 1) // Avoid divide by zero

  return segments.map(segment => ({
    ...segment,
    turns: segment.turns.map(turn => ({
      ...turn,
      width:
        MINIMAP_MIN_WIDTH + (turn.duration / maxDuration) * (MINIMAP_MAX_WIDTH - MINIMAP_MIN_WIDTH),
    })),
  }))
}

/**
 * Calculate turn duration from event timestamps.
 */
export function calculateDuration(events) {
  if (!events || events.length === 0) {
    return 0
  }
  const timestamps = events.map(e => (e.ts ? new Date(e.ts).getTime() : null)).filter(Boolean)
  if (timestamps.length === 0) {
    return 0
  }
  return Math.max(...timestamps) - Math.min(...timestamps)
}
