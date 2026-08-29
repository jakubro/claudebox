/** Content-derived per-turn height predictor for minimap cache seeding. */

import {
  ASSUMED_ATTACHMENT_WIDTH_PX,
  ATTACHMENT_GAP_PX,
  AVG_CHAR_WIDTH_PX,
  LINE_HEIGHT_PX,
  PX_PER_ATTACHMENT_ROW,
  PX_PER_BASH_TOOL_BLOCK,
  PX_PER_INLINE_REPLIES_PLACEHOLDER,
  PX_PER_THINKING_BLOCK,
  PX_PER_TOOL_BLOCK,
  TURN_ASSISTANT_BUBBLE_HEIGHT_PX,
  TURN_MIN_PREDICTED_HEIGHT_PX,
  TURN_USER_MESSAGE_HEIGHT_PX,
} from '../../../config/dimensions'
import { isLookupsGroupingEnabled } from '../../../config/features'
import { getToolConfig } from '../../../config/toolRegistry'
import {
  isToolBlockVisible,
  isTopLevelBashCall,
  TurnRoutingMode,
} from '../../../utils/eventProcessing'

const THINKING_TAG = /<thinking>/g

/**
 * Per-turn rendered height from content metrics and column width, with no DOM; a real measurement
 * replaces it once the turn mounts. Seeds the virtualizer for windowed-out turns and the minimap.
 * `mode` prices a routed-away block at zero via `isToolBlockVisible`, the same predicate that gates
 * the assistant bubble. Coefficients live in config/dimensions.js; a calibration spec caps drift.
 */
export function predictTurnHeight(
  turn,
  effectiveWidth,
  isCollapsed = false,
  mode = TurnRoutingMode.OFF,
) {
  if (!turn) {
    return TURN_MIN_PREDICTED_HEIGHT_PX
  }

  const charsPerLine = charsPerLineAt(effectiveWidth)
  const userLines = userMessageLines(turn, charsPerLine)
  const userHeight = TURN_USER_MESSAGE_HEIGHT_PX + userLines * LINE_HEIGHT_PX

  const metrics = countVisibleContent(turn, mode)

  // Nothing survived visibility, so the assistant bubble does not render. Attachments and inline
  // replies live in the user bubble and still price here.
  if (!metrics.hasVisibleContent) {
    return Math.max(
      TURN_MIN_PREDICTED_HEIGHT_PX,
      userHeight + attachmentContribution(turn, effectiveWidth),
    )
  }

  if (isCollapsed) {
    // Collapsed strip omits assistant content and attachments; base + user lines seed off-screen
    // turns.
    return userHeight + TURN_ASSISTANT_BUBBLE_HEIGHT_PX
  }

  const textLines = Math.ceil(metrics.textChars / charsPerLine)
  const readOnlyBlocks = isLookupsGroupingEnabled()
    ? metrics.readOnlyToolBlocks < 2
      ? metrics.readOnlyToolBlocks
      : 1
    : metrics.readOnlyToolBlocks

  const predicted =
    userHeight +
    TURN_ASSISTANT_BUBBLE_HEIGHT_PX +
    textLines * LINE_HEIGHT_PX +
    metrics.thinkingBlocks * PX_PER_THINKING_BLOCK +
    (metrics.toolBlocks + readOnlyBlocks) * PX_PER_TOOL_BLOCK +
    metrics.bashBlocks * PX_PER_BASH_TOOL_BLOCK +
    attachmentContribution(turn, effectiveWidth)

  return Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, predicted)
}

/**
 * Attachment-row + inline-replies-placeholder pixels - user-bubble chrome, priced whether or not
 * the assistant bubble renders. Row capacity is width-aware, like wrapped text.
 */
function attachmentContribution(turn, effectiveWidth) {
  const attachmentCount = turn.attachments?.length || 0
  const perRow = attachmentsPerRow(effectiveWidth)
  const attachmentRows = attachmentCount > 0 ? Math.ceil(attachmentCount / perRow) : 0
  // Collapsed by default, so a flat contribution regardless of comment count.
  const inlineRepliesHeight = turn.inlineReplies?.length > 0 ? PX_PER_INLINE_REPLIES_PLACEHOLDER : 0
  return attachmentRows * PX_PER_ATTACHMENT_ROW + inlineRepliesHeight
}

/** How many attachment items fit on one row at this column width. */
function attachmentsPerRow(effectiveWidth) {
  const pitch = ASSUMED_ATTACHMENT_WIDTH_PX + ATTACHMENT_GAP_PX
  return Math.max(1, Math.floor((effectiveWidth + ATTACHMENT_GAP_PX) / pitch))
}

/** Human-message height for the minimap's turn slice; predicted - the turn may be unmounted. */
export function predictUserMessageHeight(turn, effectiveWidth) {
  if (!turn) {
    return 0
  }

  return userMessageLines(turn, charsPerLineAt(effectiveWidth)) * LINE_HEIGHT_PX
}

/**
 * One pass over `turn.events` pricing every block category and tracking whether ANY block survives
 * visibility: non-tool blocks always do, a tool block only through `isToolBlockVisible`.
 */
function countVisibleContent(turn, mode) {
  let textChars = 0
  let thinkingBlocks = 0
  let toolBlocks = 0
  let readOnlyToolBlocks = 0
  let bashBlocks = 0
  let hasVisibleContent = false

  // Index by tool_use_id so the visibility check finds its paired result.
  const toolResultsByUseId = new Map()
  for (const event of turn.events || []) {
    if (event.subtype === 'tool_result' && event.tool_use_id) {
      toolResultsByUseId.set(event.tool_use_id, event)
    }
  }

  for (const event of turn.events || []) {
    if (event.subtype === 'tool_use') {
      const result = toolResultsByUseId.get(event.tool_use_id)
      if (!isToolBlockVisible(mode, event, result)) {
        continue
      }
      hasVisibleContent = true
      if (getToolConfig(event.content).category === 'read-only') {
        readOnlyToolBlocks += 1
      } else if (isTopLevelBashCall(event)) {
        // Only reachable when this call was NOT routed away (else isToolBlockVisible dropped it
        // above) - mode OFF, or a subagent's nested call, priced as an ordinary tool row.
        bashBlocks += 1
      } else {
        toolBlocks += 1
      }
    } else if (event.subtype === 'thinking') {
      if (event.content?.trim()) {
        thinkingBlocks += 1
        hasVisibleContent = true
      }
    } else if (event.subtype === 'text' && event.type === 'assistant') {
      const content = event.content || ''
      textChars += content.length
      if (content.trim()) {
        hasVisibleContent = true
      }
      const tagMatches = content.match(THINKING_TAG)
      if (tagMatches) {
        thinkingBlocks += tagMatches.length
      }
    } else if (event.subtype === 'compact_start' || event.subtype === 'compact_boundary') {
      hasVisibleContent = true
    }
  }

  return {
    textChars,
    thinkingBlocks,
    toolBlocks,
    readOnlyToolBlocks,
    bashBlocks,
    hasVisibleContent,
  }
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
