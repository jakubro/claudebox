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
import { normalizeToolName, ToolName } from '../../../config/schema'
import { getToolConfig } from '../../../config/toolRegistry'
import { isHiddenToolSearch } from '../../../utils/eventProcessing'

const THINKING_TAG = /<thinking>/g

/**
 * Predict per-turn rendered height from content metrics, scaled to chat column width.
 *
 * Prices a turn with no DOM, for the virtualizer sizing a windowed-out turn and the minimap sizing its segment.
 * A real measurement replaces the prediction once the turn mounts.
 *
 * Coefficients live in config/dimensions.js, calibrated against fixtures in predictor-calibration.spec.js.
 * That spec (e2e/app/tests/) also regression-tests drift under 30% per fixture.
 */
export function predictTurnHeight(turn, effectiveWidth, isCollapsed = false) {
  if (!turn) {
    return TURN_MIN_PREDICTED_HEIGHT_PX
  }

  const charsPerLine = charsPerLineAt(effectiveWidth)
  const userLines = userMessageLines(turn, charsPerLine)

  if (isCollapsed) {
    // Collapsed strip omits hidden assistant content; base + user line(s) seeds off-screen turns until measured.
    return TURN_BASE_HEIGHT_PX + userLines * LINE_HEIGHT_PX
  }

  let textChars = 0
  let thinkingBlocks = 0
  let toolBlocks = 0
  let readOnlyToolBlocks = 0
  let bashBlocks = 0

  // Index by tool_use_id (like indexEvents) so hide-check finds the paired result, avoiding over-reserved height.
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
      } else if (normalizeToolName(event.content) === ToolName.BASH) {
        bashBlocks += 1
      } else {
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

/**
 * Predict the height of a turn's human message alone, scaled to chat column width.
 *
 * The minimap draws the human message as a proportional slice of its turn's segment.
 * Measuring needs the turn mounted (windowing can't promise that), so it reuses the turn predictor's math.
 */
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
