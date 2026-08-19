/** Terminal-split effective visibility: composes persistence + live width-driven collapse. */

import { useRef } from 'react'
import {
  CHAT_SPLIT_DIVIDER_WIDTH,
  CHAT_TERMINAL_MIN_WIDTH,
  CHAT_TRANSCRIPT_MIN_WIDTH,
} from '../../../config/dimensions'
import useElementWidth from './useElementWidth'
import { useTerminalSplit } from './useTerminalSplit'

/**
 * `showTerminalSplit` is width-aware visibility (gates rendering); `terminalSplit` is the raw
 * preference (gates the toggle's pressed state). Collapse is layout, not a preference change.
 */
export function useTerminalSplitLayout(sessionId, isMobile) {
  const contentAreaRef = useRef(null)
  const contentAreaWidth = useElementWidth(contentAreaRef)
  const {
    split: terminalSplit,
    toggleEnabled: toggleTerminalSplit,
    setRatio: setTerminalSplitRatio,
  } = useTerminalSplit(sessionId)

  const canFit =
    contentAreaWidth == null ||
    contentAreaWidth >=
      CHAT_TRANSCRIPT_MIN_WIDTH + CHAT_TERMINAL_MIN_WIDTH + CHAT_SPLIT_DIVIDER_WIDTH
  const showTerminalSplit = !isMobile && !!terminalSplit?.enabled && canFit

  return {
    contentAreaRef,
    terminalSplit,
    showTerminalSplit,
    toggleTerminalSplit,
    setTerminalSplitRatio,
  }
}
