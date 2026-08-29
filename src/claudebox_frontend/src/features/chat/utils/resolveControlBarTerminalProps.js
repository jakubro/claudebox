/** Resolve the control bar's right-slot-picker suppression and effective props. */

import { CHAT_SPLIT_DEFAULT_RATIO } from '../../../config/dimensions'
import { RightSlotView } from './rightSlotViews'

/**
 * Whether the control bar stays suppressed for the right-slot hydration gap, and the props it
 * reads once it renders. Gated on `sessionId`, as hydration is, or the bar would never appear.
 */
export function resolveControlBarTerminalProps(sessionId, terminalSplit) {
  return {
    hydratingTerminalSplit: Boolean(sessionId) && terminalSplit == null,
    rightSlotView: terminalSplit?.view ?? RightSlotView.OFF,
    terminalSplitRatio: terminalSplit?.ratio ?? CHAT_SPLIT_DEFAULT_RATIO,
  }
}
