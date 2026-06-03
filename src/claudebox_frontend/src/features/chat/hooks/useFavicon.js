/** Dynamic favicon state management based on response status. */

import { useEffect, useRef } from 'react'
import { BREATH_CYCLE_MS, BREATH_INTERVAL } from '../../../config/timing'
import { useSessionsList } from '../../../context/SessionsContext'
import { deriveFaviconBgColor } from '../../../utils/color'
import {
  BREATHING_BG_PEAK_ALPHA,
  computeBreathIntensity,
  createFaviconCanvas,
  drawBreathingFavicon,
  drawDevBadge,
  drawGradientFavicon,
  drawWorkspaceBadge,
  FAVICON_SIZE,
  NORMAL_COLORS,
  NORMAL_OFFSET,
  NOTIFICATION_BG_ALPHA,
  NOTIFICATION_COLORS,
  NOTIFICATION_OFFSET,
  setFaviconFromCanvas,
  WHITE_GRADIENT,
} from '../utils/favicon'

/**
 * Manage dynamic favicon animation based on response status.
 * @param {object} params
 * @param {boolean} params.isResponding - Whether Claude is currently responding.
 */
export default function useFavicon({ isResponding }) {
  const { workspaceColor } = useSessionsList()
  const wasRespondingRef = useRef(false)
  const animationRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef('normal')

  // Initialize canvas
  useEffect(() => {
    canvasRef.current = createFaviconCanvas()

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current)
      }
    }
  }, [])

  // Update favicon based on state (runs on mount and when isResponding changes)
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) {
      return
    }

    // Clear any existing animation
    if (animationRef.current) {
      clearInterval(animationRef.current)
      animationRef.current = null
    }

    // Render order in every branch: tinted bg (if applicable) → C-arc → dev dot.
    // Workspace bg paints first so the C-arc and dev dot compose on top of it.
    // The DEV dot and workspace bg coexist on the canvas.
    const renderWorkspaceBg = ({ alpha = 1 } = {}) => {
      if (workspaceColor) {
        drawWorkspaceBadge(ctx, deriveFaviconBgColor(workspaceColor), { alpha })
      }
    }

    if (isResponding) {
      // Processing: breathing animation. CYCLE_COLORS drives the C-arc
      // regardless of workspace color so processing keeps its chromatic
      // breath identity. Workspace bg alpha pulses in sync with the arc.
      stateRef.current = 'processing'
      const startTime = Date.now()
      const animate = () => {
        const elapsed = Date.now() - startTime
        const breathPhase = (elapsed % BREATH_CYCLE_MS) / BREATH_CYCLE_MS
        ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
        renderWorkspaceBg({ alpha: computeBreathIntensity(breathPhase) * BREATHING_BG_PEAK_ALPHA })
        drawBreathingFavicon(ctx, breathPhase)
        drawDevBadge(ctx)
        setFaviconFromCanvas(canvasRef.current)
      }
      animate()
      animationRef.current = setInterval(animate, BREATH_INTERVAL)
    } else {
      // Not responding: notification if was responding while hidden, else normal.
      const isNotification = wasRespondingRef.current && document.hidden
      ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
      renderWorkspaceBg({ alpha: isNotification ? NOTIFICATION_BG_ALPHA : 1 })
      if (isNotification) {
        // NOTIFICATION_COLORS keep the arc orange on top of the dimmed
        // workspace bg so the notification signal stays legible.
        stateRef.current = 'notification'
        drawGradientFavicon(ctx, NOTIFICATION_COLORS, NOTIFICATION_OFFSET)
      } else {
        // Normal arc renders white on top of the workspace bg (when set), or
        // the NORMAL_COLORS gradient on a transparent canvas (when not set).
        stateRef.current = 'normal'
        drawGradientFavicon(ctx, workspaceColor ? WHITE_GRADIENT : NORMAL_COLORS, NORMAL_OFFSET)
      }
      drawDevBadge(ctx)
      setFaviconFromCanvas(canvasRef.current)
    }

    wasRespondingRef.current = isResponding
  }, [isResponding, workspaceColor])

  // Restore favicon on tab focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && stateRef.current === 'notification') {
        stateRef.current = 'normal'
        const ctx = canvasRef.current?.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
          if (workspaceColor) {
            drawWorkspaceBadge(ctx, deriveFaviconBgColor(workspaceColor))
          }
          drawGradientFavicon(ctx, workspaceColor ? WHITE_GRADIENT : NORMAL_COLORS, NORMAL_OFFSET)
          drawDevBadge(ctx)
          setFaviconFromCanvas(canvasRef.current)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [workspaceColor])
}
