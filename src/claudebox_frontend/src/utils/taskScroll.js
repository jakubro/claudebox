/** Resolve and jump to a task's tool block, in the transcript or in the work column. */

import { AUTOSCROLL_THRESHOLD } from '../config/dimensions'
import { TASK_HIGHLIGHT_MS } from '../config/timing'
import { findTurnRow, MOUNT_FRAMES, pollFrames } from './mountTurn'
import { computeScrollDestination, scrollAndHighlight } from './scroll'

/**
 * Locate a task's tool block, only once its turn is no longer collapsed (hidden, zero-height).
 * `root` scopes the lookup to the focused rail group, falling back to `document` on nullish.
 */
export function findVisibleToolBlock(taskId, root) {
  const el = (root || document).querySelector(`[data-tool-use-id="${CSS.escape(String(taskId))}"]`)
  return el && !el.closest('.turn-content-collapsed') ? el : null
}

/**
 * Scroll to and highlight a task's tool block within `container`, disengaging autoscroll when it
 * lands off-bottom. `markReturnedToBottom`, when given, re-engages it on an at-bottom landing.
 */
export function jumpToTask(
  el,
  container,
  { markUserIntent, markProgrammaticScroll, markReturnedToBottom },
) {
  if (!container) {
    el.classList.add('task-highlight')
    setTimeout(() => el.classList.remove('task-highlight'), TASK_HIGHLIGHT_MS)
    return
  }

  const destination = computeScrollDestination(container, el, 'top')
  const willBeAtBottom =
    container.scrollHeight - destination - container.clientHeight <= AUTOSCROLL_THRESHOLD
  if (willBeAtBottom) {
    markReturnedToBottom?.()
  } else {
    markUserIntent?.()
  }
  markProgrammaticScroll?.()
  scrollAndHighlight(container, el, {
    highlightMs: TASK_HIGHLIGHT_MS,
    highlightClass: 'task-highlight',
  })
}

/**
 * Mount a work-column turn row if it is windowed out, then land on the specific task block inside
 * it - a turn with many calls can put its Task block well below the row's own top.
 */
export function jumpToTaskInWorkColumn(
  turnIndex,
  taskId,
  { container, virtualizer, root, markUserIntent, markProgrammaticScroll, markReturnedToBottom },
) {
  const landOnBlock = row => {
    const block = row?.querySelector(`[data-tool-use-id="${CSS.escape(String(taskId))}"]`)
    if (block) {
      jumpToTask(block, container, { markUserIntent, markProgrammaticScroll, markReturnedToBottom })
    }
  }

  const existingRow = findTurnRow(turnIndex, '.work-row', root)
  if (existingRow) {
    landOnBlock(existingRow)
    return
  }
  if (!virtualizer) {
    return
  }

  markProgrammaticScroll?.()
  virtualizer.scrollToIndex(turnIndex, { align: 'start' })
  pollFrames(MOUNT_FRAMES, () => findTurnRow(turnIndex, '.work-row', root), landOnBlock)
}
