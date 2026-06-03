/** Collapse and expand XML block elements in a textarea. */

import { useCallback, useRef } from 'react'
import BlockCollapseManager from '../BlockCollapseManager'

/** Manage collapse/expand operations for XML blocks in a textarea via BlockCollapseManager. */
export default function useBlockCollapse(resizeTextarea) {
  const managerRef = useRef(null)
  if (!managerRef.current) {
    managerRef.current = new BlockCollapseManager()
  }
  const manager = managerRef.current

  const collapseLocal = useCallback(
    textarea => {
      const result = manager.collapseLocal(textarea.value, textarea.selectionStart)
      if (result) {
        textarea.value = result.value
        textarea.selectionStart = textarea.selectionEnd = result.cursor
        resizeTextarea()
      }
    },
    [resizeTextarea, manager],
  )

  const collapseAll = useCallback(
    textarea => {
      const result = manager.collapseAll(textarea.value)
      textarea.value = result.value
      resizeTextarea()
    },
    [resizeTextarea, manager],
  )

  const expandLocal = useCallback(
    textarea => {
      const result = manager.expandLocal(textarea.value, textarea.selectionStart)
      if (result) {
        textarea.value = result.value
        textarea.selectionStart = textarea.selectionEnd = result.cursor
        resizeTextarea()
      }
    },
    [resizeTextarea, manager],
  )

  const expandAll = useCallback(
    textarea => {
      const result = manager.expandAll(textarea.value)
      textarea.value = result.value
      resizeTextarea()
    },
    [resizeTextarea, manager],
  )

  const expandBeforeSubmit = useCallback(
    textarea => {
      const result = manager.expandBeforeSubmit(textarea.value)
      textarea.value = result.value
    },
    [manager],
  )

  const resetCollapse = useCallback(() => {
    manager.reset()
  }, [manager])

  return { collapseLocal, collapseAll, expandLocal, expandAll, expandBeforeSubmit, resetCollapse }
}
