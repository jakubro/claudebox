/** Hover state and dismiss timer for floating panel overlay. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOATING_PANEL_DISMISS_MS, FLOATING_PANEL_HOVER_INTENT_MS } from '../../../config/timing'

/**
 * Manage floating panel state — tracks hovered panel, anchor element, dismiss timer, and hover-intent timer.
 *
 * Both states fire the floating preview only after a shared hover-intent delay, so a brief cursor
 * graze across the strip doesn't pop previews. Maximized previews every icon; not maximized previews
 * only icons whose panel is NOT currently visible.
 *
 * @param {boolean} isMaximized - Whether the layout is currently maximized.
 * @param {string[]} activePanels - Panel IDs currently visible (dockview panels + logs strip when open).
 * @returns {{ hoveredPanelId, anchorRect, handleIconEnter, handleIconLeave, handlePanelEnter, handlePanelLeave, dismiss }}
 */
export default function useFloatingPanel(isMaximized, activePanels) {
  const [hoveredPanelId, setHoveredPanelId] = useState(null)
  const [anchorRect, setAnchorRect] = useState(null)
  const [floatingPosition, setFloatingPosition] = useState(null)
  const dismissTimerRef = useRef(null)
  const intentTimerRef = useRef(null)
  // Mirror activePanels in a ref so the intent-timer callback can read the
  // current value at fire-time. Closure captures the value at handler
  // creation, which is stale after a click toggles a panel active in the
  // 350 ms window between hover and timer fire.
  const activePanelsRef = useRef(activePanels)
  useEffect(() => {
    activePanelsRef.current = activePanels
  }, [activePanels])

  // Mirror isMaximized in a ref for the same reason: the maximized state can
  // toggle (un-maximize → maximize) inside the 350 ms window, and the fire-time
  // re-check must read the current value, not the one captured at handler creation.
  const isMaximizedRef = useRef(isMaximized)
  useEffect(() => {
    isMaximizedRef.current = isMaximized
  }, [isMaximized])

  /** Clear any pending dismiss timer. */
  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  /** Clear any pending hover-intent timer. */
  const clearIntentTimer = useCallback(() => {
    if (intentTimerRef.current) {
      clearTimeout(intentTimerRef.current)
      intentTimerRef.current = null
    }
  }, [])

  /** Start a delayed dismiss. */
  const startDismissTimer = useCallback(() => {
    clearDismissTimer()
    dismissTimerRef.current = setTimeout(() => {
      setHoveredPanelId(null)
      setAnchorRect(null)
      setFloatingPosition(null)
      dismissTimerRef.current = null
    }, FLOATING_PANEL_DISMISS_MS)
  }, [clearDismissTimer])

  /** Apply hover state immediately (used by both branches). */
  const showFloatingPanel = useCallback((panelId, buttonEl, position) => {
    setHoveredPanelId(panelId)
    setAnchorRect(buttonEl.getBoundingClientRect())
    setFloatingPosition(position)
  }, [])

  /** Handle mouse entering an icon button. */
  const handleIconEnter = useCallback(
    (panelId, buttonEl, position) => {
      clearDismissTimer()
      clearIntentTimer()
      // Not maximized: never preview a panel that's already visible.
      if (!isMaximized && activePanels?.includes(panelId)) {
        return
      }
      // Both states wait out the shared hover-intent delay so a brief graze
      // across the strip doesn't trigger spurious previews.
      intentTimerRef.current = setTimeout(() => {
        intentTimerRef.current = null
        // Re-check at fire-time: a not-maximized panel may have toggled visible
        // in the dwell window (e.g., the same click that started the hover).
        // Maximized previews every icon, so the skip is gated on !isMaximized.
        if (!isMaximizedRef.current && activePanelsRef.current?.includes(panelId)) {
          return
        }
        showFloatingPanel(panelId, buttonEl, position)
      }, FLOATING_PANEL_HOVER_INTENT_MS)
    },
    [isMaximized, activePanels, clearDismissTimer, clearIntentTimer, showFloatingPanel],
  )

  /** Handle mouse leaving an icon button. */
  const handleIconLeave = useCallback(() => {
    clearIntentTimer()
    if (hoveredPanelId !== null) {
      startDismissTimer()
    }
  }, [clearIntentTimer, hoveredPanelId, startDismissTimer])

  /** Handle mouse entering the floating panel. */
  const handlePanelEnter = useCallback(() => {
    clearDismissTimer()
    clearIntentTimer()
  }, [clearDismissTimer, clearIntentTimer])

  /** Handle mouse leaving the floating panel. */
  const handlePanelLeave = useCallback(() => {
    startDismissTimer()
  }, [startDismissTimer])

  /** Immediately dismiss the floating panel. */
  const dismiss = useCallback(() => {
    clearDismissTimer()
    clearIntentTimer()
    setHoveredPanelId(null)
    setAnchorRect(null)
    setFloatingPosition(null)
  }, [clearDismissTimer, clearIntentTimer])

  // Dismiss when un-maximized
  useEffect(() => {
    if (!isMaximized) {
      dismiss()
    }
  }, [isMaximized, dismiss])

  // Dismiss when the currently-previewed panel becomes active — covers the
  // edge case where the timer fires and the preview renders before the panel
  // toggles active (defense-in-depth alongside the timer-fire re-check).
  // Gated on !isMaximized because the maximized branch deliberately shows
  // the preview for every icon, active or not.
  useEffect(() => {
    if (!isMaximized && hoveredPanelId && activePanels?.includes(hoveredPanelId)) {
      dismiss()
    }
  }, [activePanels, hoveredPanelId, dismiss, isMaximized])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearDismissTimer()
      clearIntentTimer()
    }
  }, [clearDismissTimer, clearIntentTimer])

  return {
    hoveredPanelId,
    anchorRect,
    floatingPosition,
    handleIconEnter,
    handleIconLeave,
    handlePanelEnter,
    handlePanelLeave,
    dismiss,
  }
}
