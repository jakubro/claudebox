/** Coordinate chat panel scroll behavior and event handling. */

import { AUTOSCROLL_THRESHOLD } from '../../config/dimensions'
import { PROGRAMMATIC_SCROLL_HOLD_MS } from '../../config/timing'
import {
  hasNestedScrollableAncestor,
  isNestedScrollableConsuming,
} from '../../utils/nestedScrollable'
import { isPrimaryPointer } from '../../utils/pointer'
import {
  applyMarkProgrammaticScroll,
  applyMarkReturnedToBottom,
  applyMarkUserIntent,
  disposeScrollController,
  isScrollIntentKeydown,
} from '../../utils/scrollIntentLatch'

export default class ChatController {
  /**
   * @param {object} options
   * @param {function} [options.onAutoScrollChange] - Callback when autoscroll state changes.
   * @param {function} [options.onScrollPositionChange] - Callback when scroll position changes.
   */
  constructor(options = {}) {
    this.options = options

    // Scroll state
    this.isAutoScrollEnabled = true
    this.isProgrammaticScroll = false
    // Latched on scroll intent (wheel/touch/key); cleared only on re-engagement or session change.
    // Decouples intent from height-equality heuristics that race with streaming content growth.
    this.userIntentActive = false

    // Element references (set via initialize)
    this.elements = {
      messagesEl: null,
      panelEl: null,
    }

    // Coalescing rAF handle for auto-scroll writes
    this._rafHandle = null
    this._scrollScheduled = false

    // Programmatic-scroll release timer (used by markProgrammaticScroll)
    this._progTimer = null

    // Cleanup functions
    this.disposables = []
  }

  /** Initialize with DOM element references. */
  initialize({ messagesEl, panelEl }) {
    this.elements.messagesEl = messagesEl
    this.elements.panelEl = panelEl
  }

  /** Restore state from persisted values (e.g., context refs). */
  restoreState({ enabled, scrollPosition }) {
    if (enabled !== undefined) {
      this.isAutoScrollEnabled = enabled
    }
    if (scrollPosition !== undefined && this.elements.messagesEl) {
      this.elements.messagesEl.scrollTop = scrollPosition
    }
  }

  /** Clean up resources. */
  dispose() {
    if (this._rafHandle != null) {
      cancelAnimationFrame(this._rafHandle)
      this._rafHandle = null
      this._scrollScheduled = false
    }
    disposeScrollController(this)
  }

  /** Check if scroll is at or near bottom. */
  isAtBottom() {
    const el = this.elements.messagesEl
    if (!el) {
      return true
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    return distanceFromBottom <= AUTOSCROLL_THRESHOLD
  }

  /**
   * Mark a scroll write as programmatic for the next ~250ms. Used by callers
   * outside the controller (e.g. `useMessageJump.scrollToEdge`) to ensure
   * their scroll writes do not raise user-intent in the onScroll handler.
   */
  markProgrammaticScroll() {
    applyMarkProgrammaticScroll(this, PROGRAMMATIC_SCROLL_HOLD_MS)
  }

  /** Programmatically scroll to bottom (coalesced via single rAF). */
  scrollToBottom() {
    if (!this.isAutoScrollEnabled) {
      return
    }
    this._requestScroll()
  }

  /**
   * Request a coalesced scroll-to-bottom. Multiple calls within one rAF tick
   * collapse to a single DOM write. Skips when autoscroll is disabled.
   */
  _requestScroll() {
    if (this._scrollScheduled) {
      return
    }
    this._scrollScheduled = true
    this._rafHandle = requestAnimationFrame(() => {
      this._scrollScheduled = false
      this._rafHandle = null
      const el = this.elements.messagesEl
      if (!(el && this.isAutoScrollEnabled)) {
        return
      }
      this.isProgrammaticScroll = true
      el.scrollTop = el.scrollHeight
      // Synchronous clear (scoped to this commit) - scrolls dispatched after this point are user-driven.
      this.isProgrammaticScroll = false
    })
  }

  /**
   * Mark user intent (wheel/touch/keyboard scroll). Latched until manual
   * re-engagement at the bottom (handled in handleUserScroll). Direction-
   * aware filtering lives in the listeners (see attachInputListeners) - by
   * the time a caller reaches this method the gesture is known to express
   * intent.
   */
  markUserIntent() {
    applyMarkUserIntent(this)
  }

  /**
   * Mark a return to the bottom - clears latched intent and re-engages
   * autoscroll. Mirror of markUserIntent for callers that land the viewport
   * back at the bottom (jumpBottom, jumpNext's fall-through branch,
   * manual-scroll re-engage in handleUserScroll). Idempotent when already
   * engaged - the onAutoScrollChange callback still fires.
   */
  markReturnedToBottom() {
    applyMarkReturnedToBottom(this)
  }

  /**
   * Handle native onScroll event. Persists position; checks re-engagement
   * when the user has scrolled back to the bottom by hand. Does not classify
   * intent itself - that lives in markUserIntent driven by input listeners.
   */
  handleUserScroll() {
    const el = this.elements.messagesEl
    if (!el) {
      return
    }

    this.options.onScrollPositionChange?.(el.scrollTop)

    if (this.isProgrammaticScroll) {
      return
    }

    // Re-engagement: user manually scrolled back to bottom while intent latched.
    if (this.userIntentActive && this.isAtBottom()) {
      this.markReturnedToBottom()
    }
  }

  /**
   * Attach passive wheel/touch/keyboard listeners on the chat-messages element.
   * Each listener flags user intent; auto-scroll disengages on the first such
   * input regardless of any concurrent content-driven height changes.
   */
  attachInputListeners(messagesEl) {
    if (!messagesEl) {
      return
    }
    const onWheel = e => {
      // Pinch-zoom on macOS trackpad fires wheel with ctrlKey - does not scroll.
      if (e.ctrlKey) {
        return
      }
      // At-bottom + downward wheel is a no-op, not a gesture. Without this gate, every wheel tick
      // near bottom races markUserIntent (disable) against handleUserScroll's re-engage, flickering the indicator.
      if (this.isAtBottom() && e.deltaY > 0) {
        return
      }
      // Inner scrollable consumes this wheel; outer listener defers (code blocks, tables, any
      // nested overflow:auto/scroll container under .chat-messages).
      if (isNestedScrollableConsuming(e, messagesEl, e.deltaX, e.deltaY)) {
        return
      }
      this.markUserIntent()
    }
    // pointerdown/pointermove (touch only) share this coarse gate - no deltas to examine, and
    // browsers hand the gesture to the innermost scrollable ancestor; mouse routes through wheel instead.
    const onPointerDown = e => {
      if (e.pointerType !== 'touch' || !isPrimaryPointer(e)) {
        return
      }
      if (hasNestedScrollableAncestor(e, messagesEl)) {
        return
      }
      this.markUserIntent()
    }
    const onPointerMove = e => {
      if (e.pointerType !== 'touch' || !isPrimaryPointer(e)) {
        return
      }
      if (hasNestedScrollableAncestor(e, messagesEl)) {
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
    messagesEl.addEventListener('wheel', onWheel, { passive: true })
    messagesEl.addEventListener('pointerdown', onPointerDown, { passive: true })
    messagesEl.addEventListener('pointermove', onPointerMove, { passive: true })
    messagesEl.addEventListener('keydown', onKeyDown, { passive: true })
    this.disposables.push(() => {
      messagesEl.removeEventListener('wheel', onWheel)
      messagesEl.removeEventListener('pointerdown', onPointerDown)
      messagesEl.removeEventListener('pointermove', onPointerMove)
      messagesEl.removeEventListener('keydown', onKeyDown)
    })
  }

  /**
   * Attach ResizeObserver for scroll preservation across layout changes.
   *
   * Preserves scroll position when panels toggle or content reflows, but skips
   * width-only reflows where contentRect.height is unchanged. Tab-row layout
   * shifts triggered by panel.api.setTitle (e.g. session rename) fire the
   * observer at the same height - without the bail-out, the rAF restoration
   * writes a stale chatScrollPositionRef.current and the user's view jumps
   * to the wrong position. Routes through the same coalesced rAF as
   * event-driven autoscroll so multiple changes in one tick produce exactly
   * one DOM write.
   *
   * @param {HTMLElement} containerEl - Chat messages container element.
   * @param {{ chatScrollPositionRef: object, chatAutoScrollEnabledRef: object }} contextRefs - Context refs for cross-tab state.
   */
  attachResizeObserver(containerEl, contextRefs) {
    if (!containerEl) {
      return
    }

    let lastHeight = -1

    const resizeObserver = new ResizeObserver(entries => {
      const newHeight = entries?.[0]?.contentRect?.height ?? null
      if (newHeight === null || newHeight === lastHeight) {
        return
      }
      lastHeight = newHeight

      this.isProgrammaticScroll = true
      requestAnimationFrame(() => {
        if (this.isAutoScrollEnabled) {
          containerEl.scrollTop = containerEl.scrollHeight
        } else {
          // Disabled-autoscroll: restore the persisted position so real height changes don't shift the view.
          containerEl.scrollTop = contextRefs.chatScrollPositionRef.current
        }
        this.isProgrammaticScroll = false
      })
    })
    resizeObserver.observe(containerEl)

    this.disposables.push(() => resizeObserver.disconnect())
  }

  /** Handle events array change - scroll to bottom if autoscroll enabled. */
  onEventsChange(_events) {
    if (this.isAutoScrollEnabled) {
      this._requestScroll()
    }
  }

  /** Handle pending messages change - scroll to bottom if autoscroll enabled. */
  onPendingMessagesChange(_pendingMessages) {
    if (this.isAutoScrollEnabled) {
      this._requestScroll()
    }
  }

  /** Handle queue items change - scroll to bottom if autoscroll enabled. */
  onQueueChange(_queueItems) {
    if (this.isAutoScrollEnabled) {
      this._requestScroll()
    }
  }
}
