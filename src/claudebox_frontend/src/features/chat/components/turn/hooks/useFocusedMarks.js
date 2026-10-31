/** Read, or build, a session's matcher over the workspace's tools hidden from Focused by hand. */

import { useContext, useMemo } from 'react'
import { isHiddenTool } from '../../../../../config/schema'
import { useOptionalFocusedHiddenTools } from '../../../../../context/FocusedHiddenToolsContext'
import { NO_TOOL_MARKED } from '../../../../../utils/eventProcessing'
import { FocusedMarksContext } from '../FocusedMarksContext'

/** Defaults to no tool marked, no runtime and no mark offered when no provider is mounted. */
export function useFocusedMarks() {
  return useContext(FocusedMarksContext)
}

/** `FocusedMarksContext` value for a session of `runtimeName`; `canMark` is false on a phone. */
export function useFocusedMarksFor(runtimeName, canMark = true) {
  const hiddenTools = useOptionalFocusedHiddenTools()?.hiddenTools
  return useMemo(
    () => ({
      isMarked: hiddenTools?.size
        ? name => isHiddenTool(name, runtimeName, hiddenTools)
        : NO_TOOL_MARKED,
      runtimeName,
      canMark,
    }),
    [hiddenTools, runtimeName, canMark],
  )
}
