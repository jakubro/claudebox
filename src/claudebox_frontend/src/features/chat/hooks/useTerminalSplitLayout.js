/** Right-slot effective visibility: composes persistence + live width-driven collapse. */

import { useRef } from 'react'
import { CHAT_SPLIT_DIVIDER_WIDTH, CHAT_TRANSCRIPT_MIN_WIDTH } from '../../../config/dimensions'
import { RIGHT_SLOT_VIEWS, RightSlotView } from '../utils/rightSlotViews'
import useElementWidth from './useElementWidth'
import { useTerminalSplit } from './useTerminalSplit'

/**
 * `activeView` is the resolved `RIGHT_SLOT_VIEWS` record, or `null` when the preference is off,
 * the column cannot fit, or the layout is mobile; `terminalSplit` is the raw preference.
 */
export function useTerminalSplitLayout(sessionId, isMobile) {
  const contentAreaRef = useRef(null)
  const contentAreaWidth = useElementWidth(contentAreaRef)
  const {
    split: terminalSplit,
    setView: setRightSlotView,
    setRatio: setTerminalSplitRatio,
  } = useTerminalSplit(sessionId)

  const requestedView =
    terminalSplit?.view && terminalSplit.view !== RightSlotView.OFF
      ? RIGHT_SLOT_VIEWS[terminalSplit.view]
      : null
  const canFit =
    !requestedView ||
    contentAreaWidth == null ||
    contentAreaWidth >=
      CHAT_TRANSCRIPT_MIN_WIDTH + requestedView.minWidth + CHAT_SPLIT_DIVIDER_WIDTH
  const activeView = !isMobile && requestedView && canFit ? requestedView : null

  return {
    contentAreaRef,
    terminalSplit,
    activeView,
    setRightSlotView,
    setTerminalSplitRatio,
  }
}
