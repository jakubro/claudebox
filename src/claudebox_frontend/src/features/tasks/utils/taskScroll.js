/** Resolve and jump to a task's tool block, respecting autoscroll and turn collapse. */

import { AUTOSCROLL_THRESHOLD } from '../../../config/dimensions'
import { TASK_HIGHLIGHT_MS } from '../../../config/timing'
import { computeScrollDestination, scrollAndHighlight } from '../../../utils/scroll'

/** Locate a task's tool block, only once its turn is no longer collapsed (hidden, zero-height). */
export function findVisibleToolBlock(taskId) {
  const el = document.querySelector(`[data-tool-use-id="${CSS.escape(String(taskId))}"]`)
  return el && !el.closest('.turn-content-collapsed') ? el : null
}

/** Scroll to and highlight a task's tool block, disengaging autoscroll when it lands off-bottom. */
export function jumpToTask(el, { markUserIntentRef, markProgrammaticScrollRef }) {
  const chatContainer = document.querySelector('[data-testid="chat-messages"]')
  if (!chatContainer) {
    el.classList.add('task-highlight')
    setTimeout(() => el.classList.remove('task-highlight'), TASK_HIGHLIGHT_MS)
    return
  }

  // Mirrors BookmarksPanel's autoscroll gate: disengage before an off-bottom landing, and
  // bracket the write so the scroll's own events don't re-engage it.
  const destination = computeScrollDestination(chatContainer, el, 'top')
  const willBeAtBottom =
    chatContainer.scrollHeight - destination - chatContainer.clientHeight <= AUTOSCROLL_THRESHOLD
  if (!willBeAtBottom) {
    markUserIntentRef.current?.()
  }
  markProgrammaticScrollRef.current?.()
  scrollAndHighlight(chatContainer, el, {
    highlightMs: TASK_HIGHLIGHT_MS,
    highlightClass: 'task-highlight',
  })
}
