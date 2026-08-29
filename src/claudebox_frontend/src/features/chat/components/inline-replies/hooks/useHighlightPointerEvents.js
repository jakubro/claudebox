/** Hover timers, drag-guarded click, and cursor feedback over a highlighted-span container. */

import { useCallback, useEffect, useRef } from 'react'
import {
  INLINE_REPLY_HOVER_CLOSE_MS,
  INLINE_REPLY_HOVER_OPEN_MS,
} from '../../../../../config/timing'
import { DRAG_THRESHOLD_PX } from '../../../../../utils/pointer'

/**
 * Hit-tests the caller's painted ranges on mousemove - a ::highlight span has no DOM element to
 * bind to - then arms an open-intent timer and dispatches a drag-guarded click.
 * @param {object} params
 * @param {object} params.containerRef - Ref to the scroll container the highlights are painted in.
 * @param {function} params.hitTest - (x, y) => id|null.
 * @param {function} [params.canArmHover] - (id) => boolean, gates the hover-open timer per move.
 * @param {function} [params.canStartClose] - () => boolean, gates the hover-close timer.
 * @param {function} [params.onHitChange] - (id|null) => void, called on every resolved hit.
 * @param {function} params.onHoverOpen - (id) => void, fired once the open-intent delay elapses.
 * @param {function} params.onHoverClose - () => void, fired once the close delay elapses.
 * @param {function} params.onHit - (id) => void, fired for a genuine (non-drag) click on a hit.
 * @returns {{clearOpenTimer: function, clearCloseTimer: function, startCloseTimer: function}}
 *   Exposed so a caller can drive the same close timer from a second surface.
 */
export default function useHighlightPointerEvents({
  containerRef,
  hitTest,
  canArmHover = () => true,
  canStartClose = () => true,
  onHitChange,
  onHoverOpen,
  onHoverClose,
  onHit,
}) {
  const openTimerRef = useRef(null)
  const closeTimerRef = useRef(null)
  const pointerDownPosRef = useRef(null)

  const clearOpenTimer = useCallback(() => {
    clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])

  const clearCloseTimer = useCallback(() => {
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const startCloseTimer = useCallback(() => {
    if (closeTimerRef.current == null) {
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        onHoverClose()
      }, INLINE_REPLY_HOVER_CLOSE_MS)
    }
  }, [onHoverClose])

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return undefined
    }

    let raf = null
    const onMove = e => {
      if (e.buttons !== 0 || raf != null) {
        return // a pressed button means a drag-selection is underway; don't pop hover floats
      }

      const { clientX, clientY } = e
      raf = requestAnimationFrame(() => {
        raf = null
        const hit = hitTest(clientX, clientY)
        container.style.cursor = hit ? 'pointer' : ''
        onHitChange?.(hit)

        if (hit) {
          clearCloseTimer()

          if (canArmHover(hit) && openTimerRef.current == null) {
            openTimerRef.current = setTimeout(() => {
              openTimerRef.current = null
              onHoverOpen(hit)
            }, INLINE_REPLY_HOVER_OPEN_MS)
          }
        } else {
          clearOpenTimer()

          if (canStartClose()) {
            startCloseTimer()
          }
        }
      })
    }

    const onPointerDown = e => {
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY }
    }

    const onClick = e => {
      // A drag-select that merely ends on a highlight must not toggle anything
      const down = pointerDownPosRef.current

      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= DRAG_THRESHOLD_PX) {
        return
      }

      const hit = hitTest(e.clientX, e.clientY)

      if (hit) {
        e.stopPropagation() // don't let the transcript-background click refocus the composer
        clearOpenTimer()
        clearCloseTimer()
        onHit(hit)
      }
    }

    // Leaving the transcript fires no further mousemove, so dismiss the hover float here too; the
    // float's own mouseenter cancels this, preserving the span -> float bridge.
    const onLeave = () => {
      clearOpenTimer()
      container.style.cursor = ''
      onHitChange?.(null)

      if (canStartClose()) {
        startCloseTimer()
      }
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('mousemove', onMove)
    container.addEventListener('click', onClick)
    container.addEventListener('mouseleave', onLeave)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('click', onClick)
      container.removeEventListener('mouseleave', onLeave)
      container.style.cursor = ''

      if (raf != null) {
        cancelAnimationFrame(raf)
      }
    }
  }, [
    containerRef,
    hitTest,
    canArmHover,
    canStartClose,
    onHitChange,
    onHoverOpen,
    onHit,
    clearCloseTimer,
    clearOpenTimer,
    startCloseTimer,
  ])

  // Clear pending timers on unmount - a caller's onHoverOpen/onHoverClose must never fire after.
  useEffect(() => {
    return () => {
      clearOpenTimer()
      clearCloseTimer()
    }
  }, [clearOpenTimer, clearCloseTimer])

  return { clearOpenTimer, clearCloseTimer, startCloseTimer }
}
