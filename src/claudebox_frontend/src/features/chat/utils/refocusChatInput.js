/** Refocus the chat textarea when an empty .chat-messages background is clicked. */

import { DRAG_THRESHOLD_PX } from '../../../utils/pointer'

/**
 * Restore focus to the chat textarea when a click resolves to an empty area of
 * the messages container — but only when it was a clean click, not a drag-select.
 *
 * Skipped when any of:
 *  - the pointer travelled ≥ {@link DRAG_THRESHOLD_PX} between down and up
 *    (the user was drag-selecting text);
 *  - a live text selection is in progress;
 *  - the click landed on a turn descendant or any interactive child
 *    (button, link, input, textarea, select, [role="button"], [contenteditable]);
 *  - the textarea is missing or already focused.
 *
 * @param {PointerEvent} e - The click event.
 * @param {{x: number, y: number} | null} downPos - The pointer-down coordinates
 *   captured by the matching `pointerdown` handler.
 */
export function tryRefocusChatTextarea(e, downPos) {
  if (downPos) {
    const dx = e.clientX - downPos.x
    const dy = e.clientY - downPos.y
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      return
    }
  }
  const sel = window.getSelection?.()
  if (sel && !sel.isCollapsed) {
    return
  }
  if (
    e.target !== e.currentTarget &&
    (e.target.closest('[data-turn-id]') ||
      e.target.closest('button, a, input, textarea, select, [role="button"], [contenteditable]'))
  ) {
    return
  }
  const ta = document.querySelector('[data-testid="chat-input"]')
  if (ta && document.activeElement !== ta) {
    ta.focus()
  }
}
