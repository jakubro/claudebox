/** Shared latch semantics and key gating for scroll-intent controllers. */

/** Keys that count as scroll intent, matching native scroll-key behaviour. */
export const SCROLL_INTENT_KEYS = new Set([
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  ' ', // Space (Shift+Space scrolls up)
])

/** Keys whose native direction is downward; at-bottom they're a no-op, not intent. */
const SCROLL_DOWN_KEYS = new Set(['PageDown', 'End', 'ArrowDown'])

/**
 * True if a keydown expresses genuine scroll intent - false in a text field, outside the key set,
 * or for an at-bottom scroll-down key, which cannot move the view.
 */
export function isScrollIntentKeydown(event, isAtBottom) {
  // Every Alt combination in this app is an application binding, never a scroll gesture, so a
  // scroll-intent listener must not react to one on its way to that binding's handler.
  if (event.altKey) {
    return false
  }
  if (event.target?.matches?.('textarea, input, [contenteditable="true"]')) {
    return false
  }
  if (!SCROLL_INTENT_KEYS.has(event.key)) {
    return false
  }
  if (isAtBottom && (SCROLL_DOWN_KEYS.has(event.key) || (event.key === ' ' && !event.shiftKey))) {
    return false
  }
  return true
}

/**
 * Mark user intent (wheel/touch/keyboard scroll) on a `{userIntentActive, isAutoScrollEnabled,
 * options}`-shaped controller. Latched until manual re-engagement at the bottom.
 */
export function applyMarkUserIntent(controller) {
  controller.userIntentActive = true
  if (controller.isAutoScrollEnabled) {
    controller.isAutoScrollEnabled = false
    controller.options.onAutoScrollChange?.(false)
  }
}

/**
 * Mark a return to the bottom on a `{userIntentActive, isAutoScrollEnabled, options}`-shaped
 * controller - clears latched intent and re-engages autoscroll. Idempotent when already engaged.
 */
export function applyMarkReturnedToBottom(controller) {
  controller.userIntentActive = false
  controller.isAutoScrollEnabled = true
  controller.options.onAutoScrollChange?.(true)
}

/**
 * Bracket a scroll write as programmatic for `holdMs` on a `{isProgrammaticScroll, _progTimer}`-
 * shaped controller, so it raises no user-intent. Repeated calls extend the hold.
 */
export function applyMarkProgrammaticScroll(controller, holdMs) {
  controller.isProgrammaticScroll = true
  if (controller._progTimer != null) {
    clearTimeout(controller._progTimer)
  }
  controller._progTimer = setTimeout(() => {
    controller.isProgrammaticScroll = false
    controller._progTimer = null
  }, holdMs)
}

/**
 * Clear a pending `applyMarkProgrammaticScroll` timer and run every registered disposable on a
 * `{_progTimer, disposables}`-shaped controller.
 */
export function disposeScrollController(controller) {
  if (controller._progTimer != null) {
    clearTimeout(controller._progTimer)
    controller._progTimer = null
  }
  for (const cleanup of controller.disposables) {
    cleanup()
  }
  controller.disposables = []
}
