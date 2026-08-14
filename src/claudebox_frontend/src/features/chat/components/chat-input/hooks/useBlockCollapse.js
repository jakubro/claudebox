/** Collapse and expand XML block elements in a textarea. */

import { useCallback, useRef } from 'react'
import BlockCollapseManager from '../BlockCollapseManager'

export default function useBlockCollapse() {
  const managerRef = useRef(null)
  if (!managerRef.current) {
    managerRef.current = new BlockCollapseManager()
  }
  const manager = managerRef.current

  const collapseLocal = useCallback(
    textarea => _applyAtCursor(textarea, manager.collapseLocal.bind(manager)),
    [manager],
  )

  const collapseAll = useCallback(
    textarea => {
      const result = manager.collapseAll(textarea.value)
      textarea.value = result.value
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [manager],
  )

  const expandLocal = useCallback(
    textarea => _applyAtCursor(textarea, manager.expandLocal.bind(manager)),
    [manager],
  )

  const expandAll = useCallback(
    textarea => {
      const result = manager.expandAll(textarea.value)
      textarea.value = result.value
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [manager],
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

  return {
    collapseLocal,
    collapseAll,
    expandLocal,
    expandAll,
    expandBeforeSubmit,
    resetCollapse,
    manager,
  }
}

/** Apply a cursor-scoped manager result to the textarea; no-op if cursor isn't on a matching block. */
function _applyAtCursor(textarea, managerFn) {
  const result = managerFn(textarea.value, textarea.selectionStart)
  if (result) {
    textarea.value = result.value
    textarea.selectionStart = textarea.selectionEnd = result.cursor
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }
}
