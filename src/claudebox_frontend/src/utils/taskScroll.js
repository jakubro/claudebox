/** Resolve and jump to a task's tool block, in the transcript, the work column or the terminal column. */

import { AUTOSCROLL_THRESHOLD } from '../config/dimensions'
import { TASK_HIGHLIGHT_MS } from '../config/timing'
import { findTurnRow, MOUNT_FRAMES, pollFrames } from './mountTurn'
import { computeScrollDestination, scrollAndHighlight } from './scroll'

/**
 * Locate a task's tool block, only once its turn is no longer collapsed (hidden, zero-height).
 * `root` scopes the lookup to the focused rail group, falling back to `document` on nullish.
 * With `reveal`, a closed Lookups group holding the call is opened and a folded block unfolded.
 */
export function findVisibleToolBlock(taskId, root, { reveal = false } = {}) {
  const scope = root || document
  const id = CSS.escape(String(taskId))
  if (reveal) {
    scope
      .querySelector(
        `[data-testid="lookups-group"][data-expanded="false"][data-lookup-ids~="${id}"]`,
      )
      ?.querySelector(':scope > .tool-header-area')
      ?.click()
  }
  const el = scope.querySelector(`[data-tool-use-id="${id}"]`)
  if (!el || el.closest('.turn-content-collapsed')) {
    return null
  }
  if (reveal && el.dataset.expanded === 'false') {
    el.querySelector(':scope > .tool-header-area')?.click()
  }
  return el
}

/**
 * Scroll to and highlight a task's tool block within `container`, disengaging autoscroll when it
 * lands off-bottom. `markReturnedToBottom`, when given, re-engages it on an at-bottom landing.
 * The flash is the Tasks panel's unless a caller names its own class and length.
 */
export function jumpToTask(
  el,
  container,
  {
    markUserIntent,
    markProgrammaticScroll,
    markReturnedToBottom,
    highlightClass = 'task-highlight',
    highlightMs = TASK_HIGHLIGHT_MS,
  },
) {
  if (!container) {
    el.classList.add(highlightClass)
    setTimeout(() => el.classList.remove(highlightClass), highlightMs)
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
  scrollAndHighlight(container, el, { highlightMs, highlightClass })
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

/** Mount a windowed-out terminal entry if needed, then land on the command's entry. */
export function jumpToTaskInTerminalColumn(
  entryIndex,
  taskId,
  { container, virtualizer, root, markUserIntent, markProgrammaticScroll, markReturnedToBottom },
) {
  const findEntry = () =>
    (root || document).querySelector(
      `.terminal-entry[data-tool-use-id="${CSS.escape(String(taskId))}"]`,
    )
  const landOnEntry = entry => {
    if (entry) {
      jumpToTask(entry, container, { markUserIntent, markProgrammaticScroll, markReturnedToBottom })
    }
  }

  const existing = findEntry()
  if (existing) {
    landOnEntry(existing)
    return
  }
  if (!virtualizer || entryIndex < 0) {
    return
  }

  markProgrammaticScroll?.()
  virtualizer.scrollToIndex(entryIndex, { align: 'start' })
  pollFrames(MOUNT_FRAMES, findEntry, landOnEntry)
}
