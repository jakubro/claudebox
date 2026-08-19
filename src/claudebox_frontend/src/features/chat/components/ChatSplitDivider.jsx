/** Draggable divider between the chat transcript and terminal columns. */

import { usePointerDragHandle } from '../../../hooks/usePointerDragHandle'
import { clampSplitRatio } from '../utils/clampSplitRatio'

/**
 * @param {number} props.ratio - Share 0-1; +dx grows this column, clamped to measured panel width.
 */
export default function ChatSplitDivider({ ratio, onRatioChange }) {
  const { handlePointerDown, handlePointerMove, handlePointerUp } = usePointerDragHandle({
    axis: 'x',
    onDragStart: e => {
      const container = e.currentTarget.closest('.chat-content-area')
      return container ? { startRatio: ratio, width: container.clientWidth } : null
    },
    onDragMove: (drag, dx) => {
      if (drag.width <= 0) {
        return
      }
      const rawRatio = drag.startRatio + dx / drag.width
      onRatioChange(clampSplitRatio(rawRatio, drag.width))
    },
  })

  const percent = Math.round(ratio * 100)

  return (
    // biome-ignore lint/a11y/useSemanticElements: separator carries drag handlers + aria-value{now,min,max}; <hr> drops them
    <div
      className="chat-split-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat columns"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      data-testid="chat-split-divider"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  )
}
