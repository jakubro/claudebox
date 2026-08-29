/** Read-only quote highlights for an ancestor group - InlineThreadsOverlay's counterpart. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  clearAncestorHighlightRanges,
  setAncestorHighlightRanges,
} from './ancestorHighlightRegistry'
import { resolveAnchor } from './anchor'
import useHighlightPointerEvents from './hooks/useHighlightPointerEvents'
import { clampHorizontal, isRangeVisible, rangeContainsPoint, spanRect } from './overlayDom'
import PromotedThreadCard from './PromotedThreadCard'

/**
 * @param {object} props
 * @param {string} props.sessionId - This ancestor's own session id, the registry contribution key.
 * @param {object} props.messagesRef - Ref to this ancestor's own `.chat-messages` scroll container.
 * @param {Array} props.sentThreads - Sent replies: ordinary ones paint a highlight only,
 *   rail-promoted ones also get a hover card and click-to-focus.
 * @param {function} props.onFocusThread - (threadSessionId) => void, from a click or the card.
 */
export default function AncestorQuoteHighlights({
  sessionId,
  messagesRef,
  sentThreads,
  onFocusThread,
}) {
  const rangesByIdRef = useRef(new Map())
  const [tick, setTick] = useState(0)
  const [hoveredId, setHoveredId] = useState(null)
  const [position, setPosition] = useState(null)
  const floatRef = useRef(null)
  const hoveredIdRef = useRef(null)

  hoveredIdRef.current = hoveredId

  const anchorSignal = useMemo(
    () => sentThreads.map(r => `${r.id}:${r.turnId}`).join('|'),
    [sentThreads],
  )

  // Resolve every sent reply's span once the ancestor's turns are painted. Ancestors never stream
  // and never grow, so one resolve per mount or data change is enough - no MutationObserver.
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchorSignal forces a re-anchor when the reply set changes, not sentThreads' own identity
  useEffect(() => {
    const container = messagesRef.current

    if (!container) {
      return undefined
    }

    const raf = requestAnimationFrame(() => {
      const byId = new Map()
      const ranges = []

      for (const reply of sentThreads) {
        const roleEl = reply.turnId
          ? container.querySelector(
              `[data-turn-id="${CSS.escape(reply.turnId)}"] [data-testid="message-${reply.from}"]`,
            )
          : null

        if (!roleEl) {
          continue
        }

        const range = resolveAnchor(reply, roleEl)

        if (range) {
          byId.set(reply.id, { range, reply })
          ranges.push(range)
        }
      }

      rangesByIdRef.current = byId
      setAncestorHighlightRanges(sessionId, ranges)
      setTick(t => t + 1)
    })

    return () => cancelAnimationFrame(raf)
  }, [sessionId, messagesRef, anchorSignal])

  // Drop this ancestor's contribution to the shared union on unmount or session change - a stale
  // ancestor's ranges must never keep painting once it's gone (walked forward past, depth-capped).
  useEffect(() => {
    return () => clearAncestorHighlightRanges(sessionId)
  }, [sessionId])

  // Hit-testing is scoped to rail-promoted spans only - an ordinary sent quote stays an inert
  // highlight, with no card and no cursor change.
  const hitTest = useCallback((x, y) => {
    for (const [id, entry] of rangesByIdRef.current) {
      if (
        entry.reply.railPromoted &&
        rangeContainsPoint(entry.range, x, y) &&
        isRangeVisible(entry.range)
      ) {
        return id
      }
    }

    return null
  }, [])

  const canArmHover = useCallback(hit => hit !== hoveredIdRef.current, [])
  const canStartClose = useCallback(() => hoveredIdRef.current != null, [])
  const handleHoverOpen = useCallback(hit => setHoveredId(hit), [])
  const handleHoverClose = useCallback(() => setHoveredId(null), [])
  const handleHit = useCallback(
    hit => onFocusThread(rangesByIdRef.current.get(hit).reply.threadSessionId),
    [onFocusThread],
  )

  const { clearCloseTimer, startCloseTimer } = useHighlightPointerEvents({
    containerRef: messagesRef,
    hitTest,
    canArmHover,
    canStartClose,
    onHoverOpen: handleHoverOpen,
    onHoverClose: handleHoverClose,
    onHit: handleHit,
  })

  // Position the hover card at the span's end, clamped inside this ancestor's fixed-width column.
  // No stacking: the column is narrow enough that only one card is ever open in it at a time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick recomputes position off rangesByIdRef after each re-anchor
  useLayoutEffect(() => {
    const container = messagesRef.current

    if (!(container && hoveredId)) {
      setPosition(null)
      return
    }

    const entry = rangesByIdRef.current.get(hoveredId)

    if (!(entry && isRangeVisible(entry.range))) {
      setPosition(null)
      return
    }

    const rect = spanRect(entry.range)

    if (!rect) {
      setPosition(null)
      return
    }

    const containerRect = container.getBoundingClientRect()
    const el = floatRef.current
    const width = el ? el.getBoundingClientRect().width : 320
    const left = clampHorizontal(
      { left: rect.right, width },
      { left: containerRect.left, right: containerRect.right },
    )

    setPosition({ left, top: rect.bottom })
  }, [messagesRef, hoveredId, tick])

  if (!(hoveredId && position)) {
    return null
  }

  const entry = rangesByIdRef.current.get(hoveredId)

  if (!entry) {
    return null
  }

  return createPortal(
    <div
      ref={floatRef}
      className="inline-float"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onMouseEnter={clearCloseTimer}
      onMouseLeave={startCloseTimer}>
      <PromotedThreadCard
        quote={entry.reply.quote}
        threadSessionId={entry.reply.threadSessionId}
        onFocus={onFocusThread}
      />
    </div>,
    document.body,
  )
}
