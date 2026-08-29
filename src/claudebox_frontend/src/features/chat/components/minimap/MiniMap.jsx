/** Scrollbar replacement showing conversation structure and navigation. */

// audit-ignore-file: excessive-props

import { useCallback, useEffect, useMemo } from 'react'
import { MINIMAP_MIN_WIDTH } from '../../../../config/dimensions'
import { normalizeWidths } from '../../utils/normalizeMinimapWidths'
import { useMinimapOverlay } from '../useMinimapOverlay'
import { buildSegments } from './utils/minimap'

const SEGMENT_COLORS = ['#3a4a5c', '#5c3a5b']

const EMPTY_HEIGHTS = {}

/**
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
 * @param {Function} props.getLogicalScrollHeight - Thumb-size denominator across mount/unmount, unlike position.
 * @param {Function} [props.onScrollLanding] - Fired after a click/drag with whether it landed at
 *   the bottom; omitted here, so such a write bypasses the transcript's scroll owner.
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
  onScrollLanding = null,
}) {
  const segments = useMemo(() => {
    const raw = buildSegments(groups, turnHeights, userMessageHeights)
    return normalizeWidths(raw)
  }, [groups, turnHeights, userMessageHeights])

  // Stable across renders (autoScrollEnabledRef itself never changes identity), so it doesn't
  // thrash the overlay hook's attach effect on every render.
  const getAutoScrollEnabled = useCallback(
    () => autoScrollEnabledRef?.current,
    [autoScrollEnabledRef],
  )

  const {
    mapRef,
    visible,
    viewport,
    controller,
    handleClick,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
  } = useMinimapOverlay({
    containerRef: messagesRef,
    getAutoScrollEnabled,
    getLogicalScrollHeight,
    onScrollLanding,
    persistent,
    reattachTrigger: segments.length,
  })

  // Forces visibility in non-persistent mode during active streaming.
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
