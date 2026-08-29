/** Wire a MinimapController to React state and pointer events - shared by both variants. */

import { useCallback, useEffect, useRef, useState } from 'react'
import MinimapController from './MinimapController'

/**
 * Owns the controller instance, its attach/detach lifecycle, and the four pointer handlers every
 * overview needs. Callers keep their own reattach trigger and any extra transition of their own.
 *
 * @param {object} containerRef - Ref to the scroll container the overview tracks.
 * @param {function} [getAutoScrollEnabled] - See `MinimapController.attach`.
 * @param {function} [getLogicalScrollHeight] - See `MinimapController.attach`.
 * @param {function} [onScrollLanding] - See `MinimapController.attach`.
 * @param {boolean} [persistent] - Pinned open.
 * @param {*} reattachTrigger - Re-runs the attach effect when this changes - `mapRef` only
 *   resolves to a DOM element once the caller's own "has content" gate first renders it.
 */
export function useMinimapOverlay({
  containerRef,
  getAutoScrollEnabled = null,
  getLogicalScrollHeight = null,
  onScrollLanding = null,
  persistent = false,
  reattachTrigger,
}) {
  const mapRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [viewport, setViewport] = useState({ top: 0, height: 100 })

  const controllerRef = useRef(null)
  if (!controllerRef.current) {
    controllerRef.current = new MinimapController({
      onViewportChange: v => setViewport(v),
      onVisibilityChange: v => setVisible(v),
    })
  }
  const controller = controllerRef.current

  // biome-ignore lint/correctness/useExhaustiveDependencies: reattachTrigger re-attaches once mapRef resolves
  useEffect(() => {
    const container = containerRef?.current
    const map = mapRef.current
    controller.attach(container, map, getAutoScrollEnabled, getLogicalScrollHeight, onScrollLanding)
    return () => controller.detach()
  }, [
    containerRef,
    controller,
    getAutoScrollEnabled,
    getLogicalScrollHeight,
    onScrollLanding,
    reattachTrigger,
  ])

  useEffect(() => {
    controller.setPersistent(persistent)
  }, [persistent, controller])

  const handleClick = useCallback(
    e => {
      const map = mapRef.current
      if (!map) {
        return
      }
      const rect = map.getBoundingClientRect()
      controller.handleClick(e.clientY - rect.top, rect.height)
    },
    [controller],
  )

  const handlePointerDown = useCallback(
    e => {
      e.preventDefault()
      controller.startDrag(e)
    },
    [controller],
  )

  const handlePointerEnter = useCallback(() => controller.handleMouseEnter(), [controller])
  const handlePointerLeave = useCallback(() => controller.handleMouseLeave(), [controller])

  return {
    mapRef,
    visible,
    viewport,
    controller,
    handleClick,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
  }
}
