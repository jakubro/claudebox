/** Floating overlay that renders a panel component on icon hover while maximized. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  FLOATING_PANEL_MIN_HEIGHT,
  FLOATING_PANEL_WIDTH,
  WIDE_FLOAT_MIN_HEIGHT_RATIO,
  WIDE_FLOAT_MIN_WIDTH,
  WIDE_FLOAT_MIN_WIDTH_RATIO,
} from '../../../config/dimensions'
import { components } from '../../../config/layout'
import { WIDE_FLOATING_PANELS } from '../../../config/panel'

/**
 * Render a panel component as a positioned floating overlay anchored to an icon button.
 *
 * Vertical position is clamped to the icon strip's bounding rect so the panel
 * never overflows above or below the strip. Wide panels (logs, containers)
 * use larger minimum dimensions because their content benefits from extra
 * horizontal/vertical space.
 *
 * @param {object} props
 * @param {string|null} props.panelId - Which panel to render, or null to hide.
 * @param {DOMRect|null} props.anchorRect - Bounding rect of the anchor icon button.
 * @param {'left'|'right'} props.position - Which side the icon strip is on.
 * @param {Function} props.onMouseEnter - Keep panel open on cursor enter.
 * @param {Function} props.onMouseLeave - Start dismiss on cursor leave.
 * @param {Function} props.onDismiss - Immediate dismiss (Escape key).
 */
export default function FloatingPanel({
  panelId,
  anchorRect,
  position,
  onMouseEnter,
  onMouseLeave,
  onDismiss,
}) {
  const PanelComponent = panelId ? components[panelId] : null
  const panelRef = useRef(null)
  const [clampedTop, setClampedTop] = useState(null)
  const [resizeTick, setResizeTick] = useState(0)

  // Escape key dismisses the floating panel
  useEffect(() => {
    if (!panelId) {
      return
    }
    const handleKeyDown = e => {
      if (e.key === 'Escape') {
        onDismiss()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [panelId, onDismiss])

  // Re-clamp on window resize so the panel stays within the icon strip bounds
  useEffect(() => {
    const onResize = () => setResizeTick(t => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Clamp vertical position to icon strip bounds after render (pre-paint).
  // panelId and resizeTick are intentional re-trigger deps even though the
  // effect body doesn't read them directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on panel switch and window resize
  useLayoutEffect(() => {
    if (!(panelRef.current && anchorRect)) {
      return
    }
    const stripSelector = position === 'left' ? '.icon-strip-left' : '.icon-strip-right'
    const stripEl = document.querySelector(stripSelector)
    if (!stripEl) {
      setClampedTop(anchorRect.top)
      return
    }
    const stripRect = stripEl.getBoundingClientRect()
    const panelHeight = panelRef.current.offsetHeight
    let top = anchorRect.top
    if (top + panelHeight > stripRect.bottom) {
      top = stripRect.bottom - panelHeight
    }
    top = Math.max(stripRect.top, top)
    setClampedTop(top)
  }, [panelId, anchorRect, position, resizeTick])

  if (!(PanelComponent && anchorRect)) {
    return null
  }

  // Wide panels (logs, containers) get larger minimum dimensions
  const isWide = WIDE_FLOATING_PANELS.has(panelId)
  let width = FLOATING_PANEL_WIDTH
  let minHeight = FLOATING_PANEL_MIN_HEIGHT

  if (isWide) {
    const stripSelector = position === 'left' ? '.icon-strip-left' : '.icon-strip-right'
    const stripEl = document.querySelector(stripSelector)
    const stripHeight = stripEl ? stripEl.getBoundingClientRect().height : 0
    minHeight = Math.max(
      FLOATING_PANEL_MIN_HEIGHT,
      Math.round(stripHeight * WIDE_FLOAT_MIN_HEIGHT_RATIO),
    )
    width = Math.min(
      window.innerWidth,
      Math.max(WIDE_FLOAT_MIN_WIDTH, Math.round(window.innerWidth * WIDE_FLOAT_MIN_WIDTH_RATIO)),
    )
  }

  const style = {
    top: clampedTop ?? anchorRect.top,
    width,
    minHeight,
  }

  if (position === 'left') {
    style.left = anchorRect.right
  } else {
    style.right = window.innerWidth - anchorRect.left
  }

  return (
    <div
      ref={panelRef}
      className={`floating-panel floating-panel-${position}`}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}>
      <PanelComponent />
    </div>
  )
}
