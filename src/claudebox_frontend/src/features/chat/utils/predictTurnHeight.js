/** Content-derived per-turn height predictor for minimap cache seeding. */

import {
  ATTACHMENTS_PER_ROW,
  AVG_CHAR_WIDTH_PX,
  LINE_HEIGHT_PX,
  PX_PER_ATTACHMENT_ROW,
  PX_PER_THINKING_BLOCK,
  PX_PER_TOOL_BLOCK,
  TURN_BASE_HEIGHT_PX,
  TURN_MIN_PREDICTED_HEIGHT_PX,
} from '../../../config/dimensions'

const THINKING_TAG = /<thinking>/g

/**
 * Predict per-turn rendered height from content metrics, scaled to chat column width.
 *
 * Used by useTurnHeights to seed the minimap cache for off-screen turns before
 * content-visibility:auto allows real layout. Real measurements always override
 * predictions once a turn scrolls into view (or the idle warmup force-measures it).
 *
 * Coefficients live in config/dimensions.js and are calibrated against measured
 * fixtures via lib/e2e/app/tests/predictor-calibration.spec.js. The same spec
 * doubles as a regression test asserting drift stays under 30% per fixture.
 */
export function predictTurnHeight(turn, effectiveWidth) {
  if (!turn) {
    return TURN_MIN_PREDICTED_HEIGHT_PX
  }

  const charsPerLine = Math.max(20, Math.floor(effectiveWidth / AVG_CHAR_WIDTH_PX))
  let textChars = 0
  let thinkingBlocks = 0
  let toolBlocks = 0

  for (const event of turn.events || []) {
    if (event.subtype === 'tool_use') {
      toolBlocks += 1
    } else if (event.subtype === 'thinking') {
      thinkingBlocks += 1
    } else if (event.subtype === 'text' && event.type === 'assistant') {
      const content = event.content || ''
      textChars += content.length
      const tagMatches = content.match(THINKING_TAG)
      if (tagMatches) {
        thinkingBlocks += tagMatches.length
      }
    }
  }

  const userChars = (turn.userMessage || '').length
  const userLines = userChars > 0 ? Math.ceil(userChars / charsPerLine) : 0
  const textLines = Math.ceil(textChars / charsPerLine)
  const attachmentCount = turn.attachments?.length || 0
  const attachmentRows = attachmentCount > 0 ? Math.ceil(attachmentCount / ATTACHMENTS_PER_ROW) : 0

  const predicted =
    TURN_BASE_HEIGHT_PX +
    userLines * LINE_HEIGHT_PX +
    textLines * LINE_HEIGHT_PX +
    thinkingBlocks * PX_PER_THINKING_BLOCK +
    toolBlocks * PX_PER_TOOL_BLOCK +
    attachmentRows * PX_PER_ATTACHMENT_ROW

  return Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, predicted)
}
