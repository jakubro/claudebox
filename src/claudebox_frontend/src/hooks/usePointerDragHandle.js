/** Pointer-capture drag handle for draggable dividers/resize handles - no document listeners. */

import { useCallback, useRef } from 'react'
import { isPrimaryPointer } from '../utils/pointer'

/**
 * Tracks a drag through the Pointer Capture API: the element that got pointerdown keeps
 * receiving move/up after the pointer leaves it, so no document listener is needed.
 * Axis-agnostic - the caller supplies the start context and consumes the accumulated delta.
 * A `null` from `onDragStart` aborts before capture; `onDragEnd` gets the context on release.
 */
export function usePointerDragHandle({ axis, onDragStart, onDragMove, onDragEnd }) {
  const dragRef = useRef(null)
  const clientPos = useCallback(e => (axis === 'x' ? e.clientX : e.clientY), [axis])

  const handlePointerDown = useCallback(
    e => {
      if (!isPrimaryPointer(e)) {
        return
      }
      const context = onDragStart(e)
      if (context == null) {
        return
      }
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { start: clientPos(e), context }
    },
    [onDragStart, clientPos],
  )

  const handlePointerMove = useCallback(
    e => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      onDragMove(drag.context, clientPos(e) - drag.start, e)
    },
    [onDragMove, clientPos],
  )

  const handlePointerUp = useCallback(
    e => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      dragRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      onDragEnd?.(drag.context)
    },
    [onDragEnd],
  )

  return { handlePointerDown, handlePointerMove, handlePointerUp }
}
