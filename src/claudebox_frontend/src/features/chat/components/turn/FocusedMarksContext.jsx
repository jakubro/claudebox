/** A session's hand-hidden Focused tools, its runtime, and whether its blocks offer the mark. */

import { createContext } from 'react'
import { NO_TOOL_MARKED } from '../../../../utils/eventProcessing'

export const NO_FOCUSED_MARKS = Object.freeze({
  isMarked: NO_TOOL_MARKED,
  runtimeName: null,
  canMark: false,
})

export const FocusedMarksContext = createContext(NO_FOCUSED_MARKS)
