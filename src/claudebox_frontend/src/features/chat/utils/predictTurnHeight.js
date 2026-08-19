/** Content-derived per-turn height predictor for minimap cache seeding. */

import {
  ATTACHMENTS_PER_ROW,
  AVG_CHAR_WIDTH_PX,
  LINE_HEIGHT_PX,
  PX_PER_ATTACHMENT_ROW,
  PX_PER_BASH_TOOL_BLOCK,
  PX_PER_INLINE_REPLIES_PLACEHOLDER,
  PX_PER_THINKING_BLOCK,
  PX_PER_TOOL_BLOCK,
  TURN_BASE_HEIGHT_PX,
  TURN_MIN_PREDICTED_HEIGHT_PX,
} from '../../../config/dimensions'
import { isLookupsGroupingEnabled } from '../../../config/features'
import { getToolConfig } from '../../../config/toolRegistry'
import { isHiddenToolSearch, isTopLevelBashCall } from '../../../utils/eventProcessing'

const THINKING_TAG = /<thinking>/g

/**
 * Per-turn rendered height from content metrics and column width, with no DOM; a real measurement
 * replaces it once the turn mounts. Seeds the virtualizer for windowed-out turns and the minimap.
 * `splitEnabled` zeroes a top-level Bash call - it renders in the terminal column instead.
 * Coefficients: config/dimensions.js; e2e/app/tests/predictor-calibration.spec.js caps drift 30%.
 */
export function predictTurnHeight(turn, effectiveWidth, isCollapsed = false, splitEnabled = false) {
  if (!turn) {
    return TURN_MIN_PREDICTED_HEIGHT_PX
  }

  const charsPerLine = charsPerLineAt(effectiveWidth)
  const userLines = userMessageLines(turn, charsPerLine)

  if (isCollapsed) {
    // Collapsed strip omits assistant content; base + user lines seed off-screen turns.
    return TURN_BASE_HEIGHT_PX + userLines * LINE_HEIGHT_PX
  }

  let textChars = 0
  let thinkingBlocks = 0
  let toolBlocks = 0
  let readOnlyToolBlocks = 0
  let bashBlocks = 0

  // Index by tool_use_id so the hide-check finds its paired result; avoids over-reserving height.
  const toolResultsByUseId = new Map()
  for (const event of turn.events || []) {
    if (event.subtype === 'tool_result' && event.tool_use_id) {
      toolResultsByUseId.set(event.tool_use_id, event)
    }
  }

  for (const event of turn.events || []) {
    if (event.subtype === 'tool_use') {
      if (isHiddenToolSearch(event, toolResultsByUseId.get(event.tool_use_id))) {
        continue
      }
      if (getToolConfig(event.content).category === 'read-only') {
        readOnlyToolBlocks += 1
      } else if (isTopLevelBashCall(event)) {
        // Split on -> rendered in the terminal column, so no height here.
        if (!splitEnabled) {
          bashBlocks += 1
        }
      } else {
        // Non-Bash, or a subagent's nested Bash call: prices as an ordinary tool row.
        toolBlocks += 1
      }
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

  const textLines = Math.ceil(textChars / charsPerLine)
  const attachmentCount = turn.attachments?.length || 0
  const attachmentRows = attachmentCount > 0 ? Math.ceil(attachmentCount / ATTACHMENTS_PER_ROW) : 0
  // Collapsed by default, so a flat contribution regardless of comment count.
  const inlineRepliesHeight = turn.inlineReplies?.length > 0 ? PX_PER_INLINE_REPLIES_PLACEHOLDER : 0
  const readOnlyBlocks = isLookupsGroupingEnabled()
    ? readOnlyToolBlocks < 2
      ? readOnlyToolBlocks
      : 1
    : readOnlyToolBlocks

  const predicted =
    TURN_BASE_HEIGHT_PX +
    userLines * LINE_HEIGHT_PX +
    textLines * LINE_HEIGHT_PX +
    thinkingBlocks * PX_PER_THINKING_BLOCK +
    (toolBlocks + readOnlyBlocks) * PX_PER_TOOL_BLOCK +
    bashBlocks * PX_PER_BASH_TOOL_BLOCK +
    attachmentRows * PX_PER_ATTACHMENT_ROW +
    inlineRepliesHeight

  return Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, predicted)
}

/** Human-message height for the minimap's turn slice; predicted - the turn may be unmounted. */
export function predictUserMessageHeight(turn, effectiveWidth) {
  if (!turn) {
    return 0
  }

  return userMessageLines(turn, charsPerLineAt(effectiveWidth)) * LINE_HEIGHT_PX
}

/** Characters that fit on one line of the chat column. */
function charsPerLineAt(effectiveWidth) {
  return Math.max(20, Math.floor(effectiveWidth / AVG_CHAR_WIDTH_PX))
}

/** Wrapped line count of a turn's human message. */
function userMessageLines(turn, charsPerLine) {
  const userChars = (turn.userMessage || '').length

  return userChars > 0 ? Math.ceil(userChars / charsPerLine) : 0
}
