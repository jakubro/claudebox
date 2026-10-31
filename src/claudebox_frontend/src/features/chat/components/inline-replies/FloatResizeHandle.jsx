/** Bottom-right corner handle that resizes a reply box's width and body height together. */

import { INLINE_FLOAT_MIN_BODY_HEIGHT, INLINE_FLOAT_MIN_WIDTH } from '../../../../config/dimensions'
import { usePointerDragHandle } from '../../../../hooks/usePointerDragHandle'
import { clamp } from '../../../../utils/clamp'

/**
 * @param {object} props
 * @param {string} props.id - The reply whose box this resizes.
 * @param {function} props.measure - () => { width, bodyHeight, maxWidth } at drag start.
 * @param {function} props.onResize - (id, { width, height }) on every move.
 * @param {function} props.onResizeStart - (id) when a drag begins.
 * @param {function} props.onResizeEnd - (id) once the pointer is released.
 */
export default function FloatResizeHandle({ id, measure, onResize, onResizeStart, onResizeEnd }) {
  const { handlePointerDown, handlePointerMove, handlePointerUp } = usePointerDragHandle({
    axis: 'x',
    onDragStart: e => {
      onResizeStart(id)
      return { ...measure(), startY: e.clientY }
    },
    // The hook tracks one axis; the vertical delta comes from the event itself.
    onDragMove: (drag, dx, e) =>
      onResize(id, {
        width: clamp(drag.width + dx, INLINE_FLOAT_MIN_WIDTH, drag.maxWidth),
        height: Math.max(INLINE_FLOAT_MIN_BODY_HEIGHT, drag.bodyHeight + e.clientY - drag.startY),
      }),
    onDragEnd: () => onResizeEnd(id),
  })

  return (
    <div
      className="inline-float-resize"
      data-testid="inline-float-resize"
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  )
}
