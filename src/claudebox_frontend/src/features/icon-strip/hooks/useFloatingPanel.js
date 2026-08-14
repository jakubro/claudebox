/** Hover state and dismiss timer for floating panel overlay. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOATING_PANEL_DISMISS_MS, FLOATING_PANEL_HOVER_INTENT_MS } from '../../../config/timing'

/**
 * Both branches wait out a shared hover-intent delay before previewing (a quick graze won't pop one).
 * Maximized previews every icon; non-maximized skips panels already visible.
 *
 * @param {boolean} isMaximized - Current maximized state.
 * @param {string[]} activePanels - Panel IDs currently visible (dockview panels + logs strip when open).
 */
export default function useFloatingPanel(isMaximized, activePanels) {
  const [hoveredPanelId, setHoveredPanelId] = useState(null)
  const [anchorRect, setAnchorRect] = useState(null)
  const [floatingPosition, setFloatingPosition] = useState(null)
  const dismissTimerRef = useRef(null)
  const intentTimerRef = useRef(null)
  // Mirrored in a ref so the intent-timer callback reads the current value at fire-time, not a stale closure.
  const activePanelsRef = useRef(activePanels)
  useEffect(() => {
    activePanelsRef.current = activePanels
  }, [activePanels])

  // Mirrored for the same reason - isMaximized can toggle mid-delay, so fire-time must read the ref.
  const isMaximizedRef = useRef(isMaximized)
  useEffect(() => {
    isMaximizedRef.current = isMaximized
  }, [isMaximized])

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const clearIntentTimer = useCallback(() => {
    if (intentTimerRef.current) {
      clearTimeout(intentTimerRef.current)
      intentTimerRef.current = null
    }
  }, [])

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

  const handleIconEnter = useCallback(
    (panelId, buttonEl, position) => {
      clearDismissTimer()
      clearIntentTimer()
      // Not maximized: never preview a panel that's already visible.
      if (!isMaximized && activePanels?.includes(panelId)) {
        return
      }
      intentTimerRef.current = setTimeout(() => {
        intentTimerRef.current = null
        // Re-check at fire-time: a not-maximized panel may have toggled visible during the delay (e.g. the
        // click that started the hover). Maximized previews every icon, so this skip only applies when not.
        if (!isMaximizedRef.current && activePanelsRef.current?.includes(panelId)) {
          return
        }
        showFloatingPanel(panelId, buttonEl, position)
      }, FLOATING_PANEL_HOVER_INTENT_MS)
    },
    [isMaximized, activePanels, clearDismissTimer, clearIntentTimer, showFloatingPanel],
  )

  const handleIconLeave = useCallback(() => {
    clearIntentTimer()
    if (hoveredPanelId !== null) {
      startDismissTimer()
    }
  }, [clearIntentTimer, hoveredPanelId, startDismissTimer])

  const handlePanelEnter = useCallback(() => {
    clearDismissTimer()
    clearIntentTimer()
  }, [clearDismissTimer, clearIntentTimer])

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

  useEffect(() => {
    if (!isMaximized) {
      dismiss()
    }
  }, [isMaximized, dismiss])

  // Dismiss when the previewed panel goes active - covers the timer firing before the toggle
  // (defense-in-depth alongside the fire-time re-check); gated on !isMaximized, which shows every icon.
  useEffect(() => {
    if (!isMaximized && hoveredPanelId && activePanels?.includes(hoveredPanelId)) {
      dismiss()
    }
  }, [activePanels, hoveredPanelId, dismiss, isMaximized])

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
