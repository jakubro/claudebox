/** Clamp the chat/terminal split ratio so neither column drops below its minimum width. */

import { CHAT_TERMINAL_MIN_WIDTH, CHAT_TRANSCRIPT_MIN_WIDTH } from '../../../config/dimensions'

/** `ratio` is the transcript column's 0-1 share; `width` is measured `.chat-content-area` px. */
export function clampSplitRatio(ratio, width) {
  const minRatio = CHAT_TRANSCRIPT_MIN_WIDTH / width
  const maxRatio = 1 - CHAT_TERMINAL_MIN_WIDTH / width
  const lo = Math.min(minRatio, maxRatio)
  const hi = Math.max(minRatio, maxRatio)
  return Math.min(Math.max(ratio, lo), hi)
}
