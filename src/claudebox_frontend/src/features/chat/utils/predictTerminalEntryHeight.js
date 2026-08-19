/** Content-derived per-entry height predictor for the terminal column's virtualizer. */

import {
  TERMINAL_ENTRY_BASE_HEIGHT_PX,
  TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX,
  TERMINAL_LINE_HEIGHT_PX,
} from '../../../config/dimensions'
import { ToolName } from '../../../config/schema'
import { resultContentOf } from '../components/terminal/utils/terminalResult'
import { extractToolResult } from '../components/turn/components/tool-block/utils/toolResultFormatters'

/**
 * Per-entry rendered height from content line counts, with no DOM; a real measurement replaces
 * it once the entry mounts. The column never wraps, so height is a hard line count. Takes
 * precomputed `metrics` so the extraction runs once per entry, not once per estimate.
 */
export function predictTerminalEntryHeight(metrics) {
  if (!metrics) {
    return TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX
  }

  const commentLines = metrics.hasComment ? 1 : 0

  if (metrics.pending) {
    // 1 command line + 1 "Running..." line.
    const predicted = TERMINAL_ENTRY_BASE_HEIGHT_PX + (commentLines + 2) * TERMINAL_LINE_HEIGHT_PX

    return Math.max(TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX, predicted)
  }

  const outputLines = hardLineCount(metrics.outputText) + (metrics.isPersisted ? 1 : 0)
  const predicted =
    TERMINAL_ENTRY_BASE_HEIGHT_PX + (commentLines + 1 + outputLines) * TERMINAL_LINE_HEIGHT_PX

  return Math.max(TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX, predicted)
}

/** Extraction-derived metrics for one entry, cached by the caller keyed on `entry.id`. */
export function deriveEntryMetrics(entry) {
  const hasComment = !!entry.description

  if (!entry.result) {
    return { hasComment, pending: true, outputText: '', isPersisted: false }
  }

  const extracted = extractToolResult(
    ToolName.BASH,
    { command: entry.command, description: entry.description },
    resultContentOf(entry.result),
  )
  const outputText = extracted ? (extracted.details ?? extracted.summary ?? '') : ''

  return {
    hasComment,
    pending: false,
    outputText,
    isPersisted: !!extracted?.persistedOutput,
  }
}

/** Hard line count of possibly-multiline text; no wrapping, so each newline is one rendered line. */
function hardLineCount(text) {
  return text ? text.split('\n').length : 0
}
