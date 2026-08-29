/** Coordinate a right-slot column's scroll ownership: latch on intent, re-engage on return. */

import { AUTOSCROLL_THRESHOLD } from '../../../config/dimensions'
import { PROGRAMMATIC_SCROLL_HOLD_MS } from '../../../config/timing'
import {
  hasNestedScrollableAncestor,
  isNestedScrollableConsuming,
} from '../../../utils/nestedScrollable'
import { isPrimaryPointer } from '../../../utils/pointer'
import {
  applyMarkProgrammaticScroll,
  applyMarkReturnedToBottom,
  applyMarkUserIntent,
  disposeScrollController,
  isScrollIntentKeydown,
} from '../../../utils/scrollIntentLatch'

export default class ColumnScrollController {
  /**
   * @param {object} options
   * @param {function} [options.onAutoScrollChange] - Callback when autoscroll state changes.
   */
  constructor(options = {}) {
    this.options = options
    this.isAutoScrollEnabled = true
    this.isProgrammaticScroll = false
    // Latched on scroll intent (wheel/touch/key); cleared only on re-engagement or session change.
    this.userIntentActive = false
    this.containerEl = null
    this.disposables = []
    this._progTimer = null
  }

  /** Initialize with the scroll container element. */
  initialize(containerEl) {
    this.containerEl = containerEl
  }

  /** Clean up attached listeners. */
  dispose() {
    disposeScrollController(this)
  }

  /** Check if scroll is at or near bottom. */
  isAtBottom() {
    const el = this.containerEl
    if (!el) {
      return true
    }
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_THRESHOLD
  }

  /** Scroll to bottom immediately, a no-op when autoscroll is disengaged. */
  scrollToBottom() {
    const el = this.containerEl
    if (!(el && this.isAutoScrollEnabled)) {
      return
    }
    this.isProgrammaticScroll = true
    el.scrollTop = el.scrollHeight
    this.isProgrammaticScroll = false
  }

  /**
   * Mark a scroll write as programmatic for the next ~250ms, so it raises no user-intent. Without
   * it, landing near the bottom re-engages autoscroll in the same tick that disengaged it.
   */
  markProgrammaticScroll() {
    applyMarkProgrammaticScroll(this, PROGRAMMATIC_SCROLL_HOLD_MS)
  }

  /** Mark user intent (wheel/touch/keyboard scroll); disengages autoscroll. */
  markUserIntent() {
    applyMarkUserIntent(this)
  }

  /** Mark a manual return to the bottom - clears latched intent and re-engages autoscroll. */
  markReturnedToBottom() {
    applyMarkReturnedToBottom(this)
  }

  /** Handle a native onScroll event - checks re-engagement, never disengages on its own. */
  handleScroll() {
    if (this.isProgrammaticScroll) {
      return
    }
    if (this.userIntentActive && this.isAtBottom()) {
      this.markReturnedToBottom()
    }
  }

  /** Reset to the default engaged state - a session change, or the column becoming visible. */
  reset() {
    applyMarkReturnedToBottom(this)
  }

  /** Attach passive wheel/touch/keyboard listeners that flag user intent. */
  attachInputListeners(containerEl) {
    if (!containerEl) {
      return
    }
    const onWheel = e => {
      if (e.ctrlKey) {
        return
      }
      // At-bottom + downward wheel is a no-op, not a gesture - avoids flickering the indicator.
      if (this.isAtBottom() && e.deltaY > 0) {
        return
      }
      if (isNestedScrollableConsuming(e, containerEl, e.deltaX, e.deltaY)) {
        return
      }
      this.markUserIntent()
    }
    const onPointerDown = e => {
      if (e.pointerType !== 'touch' || !isPrimaryPointer(e)) {
        return
      }
      if (hasNestedScrollableAncestor(e, containerEl)) {
        return
      }
      this.markUserIntent()
    }
    const onPointerMove = e => {
      if (e.pointerType !== 'touch' || !isPrimaryPointer(e)) {
        return
      }
      if (hasNestedScrollableAncestor(e, containerEl)) {
        return
      }
      this.markUserIntent()
    }
    const onKeyDown = e => {
      if (!isScrollIntentKeydown(e, this.isAtBottom())) {
        return
      }
      this.markUserIntent()
    }
    containerEl.addEventListener('wheel', onWheel, { passive: true })
    containerEl.addEventListener('pointerdown', onPointerDown, { passive: true })
    containerEl.addEventListener('pointermove', onPointerMove, { passive: true })
    containerEl.addEventListener('keydown', onKeyDown, { passive: true })
    this.disposables.push(() => {
      containerEl.removeEventListener('wheel', onWheel)
      containerEl.removeEventListener('pointerdown', onPointerDown)
      containerEl.removeEventListener('pointermove', onPointerMove)
      containerEl.removeEventListener('keydown', onKeyDown)
    })
  }
}
