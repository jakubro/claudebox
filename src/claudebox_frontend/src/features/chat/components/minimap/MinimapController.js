/** Pure controller for minimap position, visibility, and drag state. */

import {
  MINIMAP_AUTO_HIDE_DELAY,
  MINIMAP_MIN_THUMB_HEIGHT,
  MINIMAP_MOUSE_LEAVE_DELAY,
  MINIMAP_PROXIMITY_THRESHOLD,
} from '../../../../config/dimensions'

export default class MinimapController {
  constructor({ onViewportChange, onVisibilityChange }) {
    this._onViewportChange = onViewportChange
    this._onVisibilityChange = onVisibilityChange
    this._visible = false
    this._persistent = false
    this._streaming = false
    this._dragging = false
    this._viewport = { top: 0, height: 100 }
    this._containerEl = null
    this._mapEl = null
    this._hideTimeout = null
    this._autoScrollEnabledRef = null
    this._resizeObserver = null
    this._getLogicalScrollHeight = null
    this._handleScroll = this._onScroll.bind(this)
    this._handlePointerMove = this._onPointerMove.bind(this)
  }

  get viewport() {
    return this._viewport
  }

  get isVisible() {
    return this._visible
  }

  /** Attach scroll, resize, and proximity listeners. */
  attach(containerEl, mapEl, autoScrollEnabledRef = null, getLogicalScrollHeight = null) {
    this.detach()
    this._containerEl = containerEl
    this._mapEl = mapEl
    this._autoScrollEnabledRef = autoScrollEnabledRef
    this._getLogicalScrollHeight = getLogicalScrollHeight
    if (!containerEl) {
      return
    }

    this._updateViewport()
    containerEl.addEventListener('scroll', this._handleScroll)
    containerEl.addEventListener('pointermove', this._handlePointerMove)
    this._resizeObserver = new ResizeObserver(() => this._updateViewport())
    this._resizeObserver.observe(containerEl)
  }

  /** Remove all listeners and clear timers. */
  detach() {
    if (this._containerEl) {
      this._containerEl.removeEventListener('scroll', this._handleScroll)
      this._containerEl.removeEventListener('pointermove', this._handlePointerMove)
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
      this._resizeObserver = null
    }
    this._clearHideTimeout()
    this._containerEl = null
    this._mapEl = null
    this._autoScrollEnabledRef = null
    this._getLogicalScrollHeight = null
  }

  /** Show minimap and start auto-hide timer (unless persistent or dragging). */
  show() {
    if (this._persistent || this._dragging) {
      this._clearHideTimeout()
      return
    }
    this._setVisible(true)
    this._scheduleHide(MINIMAP_AUTO_HIDE_DELAY)
  }

  /** Toggle persistent mode. */
  setPersistent(enabled) {
    this._persistent = enabled
    if (enabled) {
      this._clearHideTimeout()
      this._setVisible(true)
    } else {
      this._setVisible(false)
    }
  }

  /** Force visibility during active streaming, even when not persistent. */
  setStreaming(active) {
    this._streaming = active
    if (active) {
      this._clearHideTimeout()
      this._setVisible(true)
    } else if (!this._persistent) {
      this._scheduleHide(MINIMAP_AUTO_HIDE_DELAY)
    }
  }

  /** Jump container scroll to position based on click Y within map. */
  handleClick(clickY, mapHeight) {
    const container = this._containerEl
    if (!container || mapHeight === 0) {
      return
    }
    const ratio = clickY / mapHeight
    const targetScroll = ratio * container.scrollHeight
    container.scrollTo({ top: targetScroll, behavior: 'smooth' })
  }

  /** Begin drag-to-scroll. Returns cleanup function. */
  startDrag(initialEvent) {
    const container = this._containerEl
    const map = this._mapEl
    if (!(container && map)) {
      return () => {}
    }

    this._dragging = true
    this._clearHideTimeout()
    this._setVisible(true)

    const handleDrag = moveEvent => {
      const rect = map.getBoundingClientRect()
      const clickY = moveEvent.clientY - rect.top
      const ratio = Math.max(0, Math.min(1, clickY / rect.height))
      container.scrollTop = ratio * (container.scrollHeight - container.clientHeight)
    }

    const handleUp = () => {
      this._dragging = false
      document.removeEventListener('pointermove', handleDrag)
      document.removeEventListener('pointerup', handleUp)
      if (!this._persistent) {
        this._scheduleHide(MINIMAP_AUTO_HIDE_DELAY)
      }
    }

    handleDrag(initialEvent)
    document.addEventListener('pointermove', handleDrag)
    document.addEventListener('pointerup', handleUp)

    return handleUp
  }

  /** Pause auto-hide on mouse enter. */
  handleMouseEnter() {
    this._clearHideTimeout()
    this._setVisible(true)
  }

  /** Resume auto-hide on mouse leave (unless persistent). */
  handleMouseLeave() {
    if (this._persistent) {
      return
    }
    this._scheduleHide(MINIMAP_MOUSE_LEAVE_DELAY)
  }

  /** Recompute viewport from current scroll position. */
  updateViewport() {
    this._updateViewport()
  }

  // --- Private ---

  _onScroll() {
    this._updateViewport()
    if (!this._autoScrollEnabledRef?.current || this._streaming) {
      this.show()
    }
  }

  _onPointerMove(e) {
    const container = this._containerEl
    if (!container) {
      return
    }
    const rect = container.getBoundingClientRect()
    const distanceFromRight = rect.right - e.clientX
    if (distanceFromRight >= 0 && distanceFromRight < MINIMAP_PROXIMITY_THRESHOLD) {
      this.show()
    }
  }

  _logicalScrollHeight() {
    return this._getLogicalScrollHeight?.() ?? this._containerEl?.scrollHeight ?? 0
  }

  _updateViewport() {
    const container = this._containerEl
    const map = this._mapEl
    if (!(container && map)) {
      return
    }

    const { scrollTop, clientHeight, scrollHeight: nativeScrollHeight } = container
    const logicalScrollHeight = this._logicalScrollHeight()
    const mapHeight = map.clientHeight

    let newViewport
    if (nativeScrollHeight <= clientHeight) {
      newViewport = { top: 0, height: mapHeight }
    } else {
      // Size uses logical scrollHeight (sum of cached turn heights) for jitter
      // resistance against off-screen turn intrinsic-vs-real toggles under
      // content-visibility:auto.
      const viewportHeight = Math.max(
        MINIMAP_MIN_THUMB_HEIGHT,
        (clientHeight / logicalScrollHeight) * mapHeight,
      )
      // Position uses native scrollHeight: the browser caps scrollTop at
      // (nativeScrollHeight - clientHeight), so ratio is bounded by 1 and
      // viewportTop + viewportHeight stays <= mapHeight. The defensive
      // Math.min guards against fractional rounding and future divergence.
      const positionRange = nativeScrollHeight - clientHeight
      const trackRange = Math.max(0, mapHeight - viewportHeight)
      const ratio = positionRange > 0 ? Math.min(1, scrollTop / positionRange) : 0
      newViewport = { top: ratio * trackRange, height: viewportHeight }
    }

    this._viewport = newViewport
    this._onViewportChange(newViewport)
  }

  _setVisible(value) {
    if (this._visible === value) {
      return
    }
    this._visible = value
    this._onVisibilityChange(value)
  }

  _scheduleHide(delay) {
    this._clearHideTimeout()
    this._hideTimeout = setTimeout(() => {
      this._setVisible(false)
    }, delay)
  }

  _clearHideTimeout() {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout)
      this._hideTimeout = null
    }
  }
}
