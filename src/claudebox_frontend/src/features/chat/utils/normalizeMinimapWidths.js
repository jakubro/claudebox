/** Duration-to-width normalization shared by the transcript's overview and the terminal's. */

import { MINIMAP_MAX_WIDTH, MINIMAP_MIN_WIDTH } from '../../../config/dimensions'

/**
 * Widths in the `[MINIMAP_MIN_WIDTH, MINIMAP_MAX_WIDTH]` range, normalized against the longest
 * duration across every segment. A missing duration coerces to 0, landing at the narrowest bar.
 */
export function normalizeWidths(segments) {
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
