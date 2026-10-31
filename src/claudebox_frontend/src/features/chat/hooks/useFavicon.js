/** Dynamic favicon state management based on response status. */

import { useEffect, useRef } from 'react'
import { useSessionsList } from '../../../context/SessionsContext'
import { deriveFaviconBgColor } from '../../../utils/color'
import {
  createFaviconCanvas,
  drawDevBadge,
  drawGradientFavicon,
  drawWorkingFavicon,
  drawWorkspaceBadge,
  FAVICON_SIZE,
  NEEDS_YOU_COLORS,
  NORMAL_COLORS,
  NORMAL_OFFSET,
  NOTIFICATION_BG_ALPHA,
  NOTIFICATION_COLORS,
  NOTIFICATION_OFFSET,
  setFaviconFromCanvas,
  WAITING_ARC_ALPHA,
  WHITE_GRADIENT,
  WORKING_BG_ALPHA,
} from '../utils/favicon'

export default function useFavicon({ isResponding, isWaiting = false, needsUser = false }) {
  const { workspaceColor } = useSessionsList()
  const wasRespondingRef = useRef(false)
  const canvasRef = useRef(null)
  const stateRef = useRef('normal')

  useEffect(() => {
    canvasRef.current = createFaviconCanvas()
  }, [])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) {
      return
    }

    // Render order in every branch: bg (if set) -> arc -> dev dot; bg paints first so arc/dot compose on top.
    const renderWorkspaceBg = ({ alpha = 1 } = {}) => {
      if (workspaceColor) {
        drawWorkspaceBadge(ctx, deriveFaviconBgColor(workspaceColor), { alpha })
      }
    }

    // The working arc keeps its gradient over a workspace bg, unlike the normal arc's white.
    const drawWorking = arcAlpha => {
      ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
      renderWorkspaceBg({ alpha: WORKING_BG_ALPHA })
      drawWorkingFavicon(ctx, { alpha: arcAlpha })
      drawDevBadge(ctx)
      setFaviconFromCanvas(canvasRef.current)
    }

    if (isResponding) {
      stateRef.current = 'processing'
      drawWorking(1)
    } else if (isWaiting && !needsUser) {
      stateRef.current = 'waiting'
      drawWorking(WAITING_ARC_ALPHA)
    } else {
      // Not responding: red while the session needs the user - never gated on a turn just ending, as
      // needsUser may land a fetch later - else orange if a turn ended while hidden, else normal.
      const isNotification = !needsUser && wasRespondingRef.current && document.hidden
      ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
      renderWorkspaceBg({ alpha: needsUser || isNotification ? NOTIFICATION_BG_ALPHA : 1 })
      if (needsUser) {
        stateRef.current = 'needs-you'
        drawGradientFavicon(ctx, NEEDS_YOU_COLORS, NOTIFICATION_OFFSET)
      } else if (isNotification) {
        // Keeps the arc orange on top of the dimmed workspace bg so the notification signal stays legible.
        stateRef.current = 'notification'
        drawGradientFavicon(ctx, NOTIFICATION_COLORS, NOTIFICATION_OFFSET)
      } else {
        // White over the workspace bg if set, else the NORMAL_COLORS gradient on a transparent canvas.
        stateRef.current = 'normal'
        drawGradientFavicon(ctx, workspaceColor ? WHITE_GRADIENT : NORMAL_COLORS, NORMAL_OFFSET)
      }
      drawDevBadge(ctx)
      setFaviconFromCanvas(canvasRef.current)
    }

    wasRespondingRef.current = isResponding
  }, [isResponding, isWaiting, needsUser, workspaceColor])

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
