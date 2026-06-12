/** Scrollbar replacement showing conversation structure and navigation. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MINIMAP_MIN_WIDTH } from '../../../../config/dimensions'
import MinimapController from './MinimapController'
import { buildSegments, normalizeWidths } from './utils/minimap'

// Two alternating blue shades for segments
const SEGMENT_COLORS = [
  '#3a4a5c', // muted blue-gray
  '#5c3a5b', // muted purple
]

const EMPTY_HEIGHTS = {}

/**
 * Render mini-map overlay for conversation navigation and overview.
 * @param {Object} props
 * @param {Array} props.groups - Turn groups to display as segments
 * @param {Object} props.turnResults - Map of turn IDs to result status
 * @param {Object} props.messagesRef - Ref to messages container for scroll sync
 * @param {number} props.pendingCount - Number of pending messages to show
 * @param {Object} props.turnHeights - Map of turn indices to DOM heights
 * @param {Object} props.userMessageHeights - Map of turn indices to user message heights
 * @param {Object} props.autoScrollEnabledRef - Ref to suppress during auto-scroll
 * @param {boolean} props.isStreaming - Whether assistant is actively streaming a response
 * @param {Function} props.isTurnBookmarked - Check if any message in a turn is bookmarked
 * @param {Function} props.getLogicalScrollHeight - Stable scroll-axis total from useTurnHeights
 *   cache; used by MinimapController as the denominator for thumb-size math (jitter resistance
 *   against content-visibility:auto toggles). Thumb position uses native scrollHeight.
 */
export default function MiniMap({
  groups,
  turnResults,
  messagesRef,
  pendingCount = 0,
  turnHeights = EMPTY_HEIGHTS,
  userMessageHeights = EMPTY_HEIGHTS,
  autoScrollEnabledRef = null,
  persistent = false,
  isStreaming = false,
  isTurnBookmarked = null,
  getLogicalScrollHeight = null,
}) {
  const mapRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [viewport, setViewport] = useState({ top: 0, height: 100 })

  // Create controller once via ref
  const controllerRef = useRef(null)
  if (!controllerRef.current) {
    controllerRef.current = new MinimapController({
      onViewportChange: v => setViewport(v),
      onVisibilityChange: v => setVisible(v),
    })
  }
  const controller = controllerRef.current

  // Build segments with normalized widths
  const segments = useMemo(() => {
    const raw = buildSegments(groups, turnHeights, userMessageHeights)
    return normalizeWidths(raw)
  }, [groups, turnHeights, userMessageHeights])

  // Attach/detach DOM listeners - segments.length re-triggers when content appears/disappears
  // biome-ignore lint/correctness/useExhaustiveDependencies: segments.length ensures re-attach when mapRef transitions from null to DOM element
  useEffect(() => {
    const container = messagesRef?.current
    const map = mapRef.current
    controller.attach(container, map, autoScrollEnabledRef, getLogicalScrollHeight)
    return () => controller.detach()
  }, [messagesRef, controller, autoScrollEnabledRef, getLogicalScrollHeight, segments.length])

  // Sync persistent mode
  useEffect(() => {
    controller.setPersistent(persistent)
  }, [persistent, controller])

  // Sync streaming state - forces visibility in non-persistent mode during active streaming
  useEffect(() => {
    controller.setStreaming(isStreaming)
  }, [isStreaming, controller])

  // Poll viewport position during streaming to track scrollHeight growth
  useEffect(() => {
    if (!isStreaming) {
      return
    }
    const id = setInterval(() => {
      controller.updateViewport()
    }, 100)
    return () => clearInterval(id)
  }, [isStreaming, controller])

  // Defer viewport update to run after auto-scroll's rAF has set scrollTop
  // biome-ignore lint/correctness/useExhaustiveDependencies: groups/turnHeights trigger viewport update
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      controller.updateViewport()
    })
    return () => cancelAnimationFrame(id)
  }, [groups, turnHeights, controller])

  // Handle click to jump
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

  // Handle drag for scrollbar behavior
  const handlePointerDown = useCallback(
    e => {
      e.preventDefault()
      controller.startDrag(e)
    },
    [controller],
  )

  const handlePointerEnter = useCallback(() => controller.handleMouseEnter(), [controller])
  const handlePointerLeave = useCallback(() => controller.handleMouseLeave(), [controller])

  // Don't render if no segments
  const hasContent = segments.length > 0 || pendingCount > 0
  if (!hasContent) {
    return null
  }

  return (
    <div
      className={`minimap-overlay ${visible ? 'visible' : ''}`}
      ref={mapRef}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-testid="minimap">
      <div className="minimap-segments">
        {segments.map((segment, segIdx) => {
          const segmentColor = SEGMENT_COLORS[segment.index % SEGMENT_COLORS.length]
          return (
            <div
              key={segIdx}
              className="minimap-segment"
              data-testid="minimap-segment"
              style={{ flex: segment.turns.reduce((sum, t) => sum + t.height, 0) }}>
              {segment.turns.map((turn, turnIdx) => {
                const isError = turnResults?.[turn.turnId] === 'error'
                return (
                  <div
                    key={turnIdx}
                    className={`minimap-subbar ${isError ? 'error' : ''}`}
                    style={{
                      flex: turn.height,
                      width: turn.width,
                      backgroundColor: isTurnBookmarked?.(turn.turnId)
                        ? '#e8b931'
                        : isError
                          ? undefined
                          : segmentColor,
                    }}
                    data-testid="minimap-subbar">
                    {turn.hasUserMessage && (
                      <div
                        className="minimap-human-line"
                        data-testid="minimap-human-line"
                        style={
                          turn.userHeightPct > 0 ? { height: `${turn.userHeightPct}%` } : undefined
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        {pendingCount > 0 && (
          <div
            className="minimap-segment minimap-segment-pending"
            data-testid="minimap-segment-pending">
            {Array.from({ length: pendingCount }).map((_, i) => (
              <div
                key={`pending-${i}`}
                className="minimap-subbar pending"
                style={{ flex: 1, width: MINIMAP_MIN_WIDTH }}
                data-testid="minimap-subbar-pending"
              />
            ))}
          </div>
        )}
      </div>
      <div
        className="minimap-thumb"
        style={{ top: viewport.top, height: viewport.height }}
        data-testid="minimap-viewport"
      />
    </div>
  )
}
