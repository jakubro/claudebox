/** Span-anchored inline-replies overlay: paints durable quote highlights (CSS Custom Highlight API) and pins a floating composer to each quoted span, all owned outside the React turn tree to keep the memoized streaming render path untouched. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { INLINE_REPLY_HOVER_CLOSE_MS, INLINE_REPLY_HOVER_OPEN_MS } from '../../../../config/timing'
import { resolveAnchor } from './anchor'
import InlineThread from './InlineThread'
import {
  isRangeVisible,
  positionsEqual,
  rangeContainsPoint,
  spanRect,
  stackFloats,
} from './overlayDom'

const HIGHLIGHT_NAME = 'inline-quote'
const HIGHLIGHTS_SUPPORTED =
  typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS
const FLOAT_GAP = 8

/**
 * @param {object} props
 * @param {object} props.messagesRef - Ref to the `.chat-messages` scroll container.
 * @param {Array} props.unsent - Unsent anchored replies (editable).
 * @param {Array} props.sentThreads - Sent anchored replies (read-only), flattened across groups.
 * @param {*} props.resolveSignal - Value that changes when the turn set changes (forces re-resolve).
 * @param {number} props.maxHeight - Shared composer max height for reply autoresize.
 * @param {function} props.onEditReply - (id, response) edit callback.
 * @param {function} props.onRemove - (id) delete callback (unsent only; clears the highlight).
 * @param {function} props.onSubmitBatch - Enter-in-box sends the whole batch.
 */
export default function InlineThreadsOverlay({
  messagesRef,
  unsent,
  sentThreads,
  resolveSignal,
  maxHeight,
  onEditReply,
  onRemove,
  onSubmitBatch,
}) {
  const [hoveredId, setHoveredId] = useState(null)
  const [pinnedIds, setPinnedIds] = useState(() => new Set())
  const [positions, setPositions] = useState(() => new Map())
  const [tick, setTick] = useState(0)

  const rangesByIdRef = useRef(new Map())
  const floatRefsRef = useRef(new Map())
  const openTimerRef = useRef(null)
  const closeTimerRef = useRef(null)
  const hoveredIdRef = useRef(null)
  const pinnedIdsRef = useRef(pinnedIds)
  const unsentRef = useRef(unsent)
  const sentThreadsRef = useRef(sentThreads)
  const seenUnsentIdsRef = useRef(null)
  const focusIdRef = useRef(null)

  hoveredIdRef.current = hoveredId
  pinnedIdsRef.current = pinnedIds
  unsentRef.current = unsent
  sentThreadsRef.current = sentThreads

  // Live reply lookup by id (current response text + sent flag). Used at render so a controlled reply
  // box shows the just-typed value immediately, not the rAF-batched re-anchor cache.
  const replyById = useMemo(() => {
    const map = new Map()

    for (const reply of unsent) {
      map.set(reply.id, { reply, sent: false })
    }

    for (const reply of sentThreads) {
      map.set(reply.id, { reply, sent: true })
    }

    return map
  }, [unsent, sentThreads])

  // Re-anchoring depends on the reply SET and their spans, not the reply text - so typing a response
  // does not re-run the (TreeWalker + highlight repaint) re-anchor pass on every keystroke.
  const anchorSignal = useMemo(
    () => [...unsent, ...sentThreads].map(r => `${r.id}:${r.turnId}`).join('|'),
    [unsent, sentThreads],
  )

  // Re-anchor every reply, paint the highlights, and record ranges for hit-testing + positioning.
  const resolve = useCallback(() => {
    const container = messagesRef.current

    if (!container) {
      return
    }

    const all = [
      ...unsentRef.current.map(reply => ({ reply, sent: false })),
      ...sentThreadsRef.current.map(reply => ({ reply, sent: true })),
    ]

    const byId = new Map()
    const ranges = []

    for (const { reply, sent } of all) {
      const roleEl = reply.turnId
        ? container.querySelector(
            `[data-turn-id="${CSS.escape(reply.turnId)}"] [data-testid="message-${reply.from}"]`,
          )
        : null

      if (!roleEl) {
        continue // source turn not currently mounted; the reply stays in the buffer / event
      }

      const range = resolveAnchor(reply, roleEl)

      byId.set(reply.id, { range, reply, sent, roleEl })

      if (range) {
        ranges.push(range)
      }
    }

    rangesByIdRef.current = byId

    if (HIGHLIGHTS_SUPPORTED) {
      if (ranges.length > 0) {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
      } else {
        CSS.highlights.delete(HIGHLIGHT_NAME)
      }
    }

    setTick(t => t + 1)
  }, [messagesRef])

  // Re-anchor on data/turn change and on any transcript mutation (streaming, collapse, mount).
  // biome-ignore lint/correctness/useExhaustiveDependencies: resolveSignal/anchorSignal force a re-anchor when the reply set changes
  useEffect(() => {
    const container = messagesRef.current

    if (!container) {
      return
    }

    let raf = null
    const schedule = () => {
      if (raf == null) {
        raf = requestAnimationFrame(() => {
          raf = null
          resolve()
        })
      }
    }

    schedule()

    const observer = new MutationObserver(schedule)
    observer.observe(container, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()

      if (raf != null) {
        cancelAnimationFrame(raf)
      }
    }
  }, [resolve, resolveSignal, messagesRef, anchorSignal])

  // Reposition on scroll / resize: the cached ranges stay valid, only their client rects move.
  useEffect(() => {
    const container = messagesRef.current

    if (!container) {
      return
    }

    let raf = null
    const bump = () => {
      if (raf == null) {
        raf = requestAnimationFrame(() => {
          raf = null
          setTick(t => t + 1)
        })
      }
    }

    container.addEventListener('scroll', bump)
    window.addEventListener('resize', bump)

    return () => {
      container.removeEventListener('scroll', bump)
      window.removeEventListener('resize', bump)

      if (raf != null) {
        cancelAnimationFrame(raf)
      }
    }
  }, [messagesRef])

  // Reposition (not re-anchor) when a reply's text changes, so a growing float re-stacks vs neighbours.
  // biome-ignore lint/correctness/useExhaustiveDependencies: replyById is the reposition trigger
  useEffect(() => {
    setTick(t => t + 1)
  }, [replyById])

  // Floats to show: pinned + the one hover float + any source-moved reply (auto-shown so a reply whose
  // anchor no longer resolves is never lost - it pins at its source turn's top).
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick recomputes openIds off rangesByIdRef after each re-anchor
  const openIds = useMemo(() => {
    const ids = new Set(pinnedIds)

    if (hoveredId) {
      ids.add(hoveredId)
    }

    for (const [id, entry] of rangesByIdRef.current) {
      if (!entry.range && entry.roleEl) {
        ids.add(id)
      }
    }

    return ids
  }, [pinnedIds, hoveredId, tick])

  // On-screen position of a float from its span end (or its source-turn top when the anchor was lost).
  // Null when the span is collapsed to nothing or scrolled out of the transcript viewport.
  const anchorFor = useCallback((entry, containerRect) => {
    if (entry.range) {
      // A collapsed source turn hides its text via visibility:hidden (auto-collapse; source turns are
      // not exempt), under which the range still reports a non-zero rect - so gate on visibility.
      if (!isRangeVisible(entry.range)) {
        return null
      }

      const r = spanRect(entry.range)

      if (!r) {
        return null
      }

      if (r.bottom < containerRect.top || r.top > containerRect.bottom) {
        return null // span scrolled out of view
      }

      return { left: r.right, top: r.bottom }
    }

    const rr = entry.roleEl.getBoundingClientRect()

    return { left: rr.left, top: rr.top }
  }, [])

  // Measure the open floats and resolve collisions (pure stackFloats) after each render / tick.
  useLayoutEffect(() => {
    const container = messagesRef.current

    if (!container) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const boxes = []

    for (const id of openIds) {
      const entry = rangesByIdRef.current.get(id)

      if (!entry) {
        continue
      }

      const anchor = anchorFor(entry, containerRect)

      if (!anchor) {
        continue
      }

      const el = floatRefsRef.current.get(id)
      const rect = el ? el.getBoundingClientRect() : { width: 320, height: 80 }

      boxes.push({ id, left: anchor.left, top: anchor.top, width: rect.width, height: rect.height })
    }

    const next = stackFloats(boxes, FLOAT_GAP)

    setPositions(prev => (positionsEqual(prev, next) ? prev : next))
  }, [openIds, anchorFor, messagesRef])

  // Prune pinned / hover state for replies that no longer exist (deleted, or sent -> fresh id).
  useEffect(() => {
    const live = new Set([...unsent.map(r => r.id), ...sentThreads.map(r => r.id)])

    setPinnedIds(prev => {
      let changed = false
      const next = new Set()

      for (const id of prev) {
        if (live.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }

      return changed ? next : prev
    })

    if (hoveredIdRef.current != null && !live.has(hoveredIdRef.current)) {
      setHoveredId(null)
    }
  }, [unsent, sentThreads])

  // Auto-pin + focus a freshly-quoted reply; the restored buffer (first render) is adopted un-pinned.
  useEffect(() => {
    if (seenUnsentIdsRef.current == null) {
      seenUnsentIdsRef.current = new Set(unsent.map(r => r.id))

      return
    }

    const seen = seenUnsentIdsRef.current
    const fresh = unsent.filter(r => !seen.has(r.id))

    if (fresh.length > 0) {
      focusIdRef.current = fresh[fresh.length - 1].id
      setPinnedIds(prev => {
        const next = new Set(prev)

        for (const r of fresh) {
          next.add(r.id)
        }

        return next
      })
    }

    seenUnsentIdsRef.current = new Set(unsent.map(r => r.id))
  }, [unsent])

  // Clear the document-global highlight and any pending timers on unmount (session switch / mobile).
  useEffect(() => {
    return () => {
      if (HIGHLIGHTS_SUPPORTED) {
        CSS.highlights.delete(HIGHLIGHT_NAME)
      }

      clearTimeout(openTimerRef.current)
      clearTimeout(closeTimerRef.current)
    }
  }, [])

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
        setHoveredId(null)
      }, INLINE_REPLY_HOVER_CLOSE_MS)
    }
  }, [])

  // Hover a highlighted span -> open its float after a short intent delay; click -> pin it open.
  // Hit-testing reuses the painted ranges (a ::highlight span has no DOM element to bind to).
  useEffect(() => {
    const container = messagesRef.current

    if (!container) {
      return
    }

    const hitTest = (x, y) => {
      for (const [id, entry] of rangesByIdRef.current) {
        if (entry.range && rangeContainsPoint(entry.range, x, y) && isRangeVisible(entry.range)) {
          return id // skip spans hidden by a collapsed source turn
        }
      }

      return null
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

        if (hit) {
          clearCloseTimer()

          if (
            hit !== hoveredIdRef.current &&
            !pinnedIdsRef.current.has(hit) &&
            openTimerRef.current == null
          ) {
            openTimerRef.current = setTimeout(() => {
              openTimerRef.current = null
              setHoveredId(hit)
            }, INLINE_REPLY_HOVER_OPEN_MS)
          }
        } else {
          clearOpenTimer()

          if (hoveredIdRef.current != null && !pinnedIdsRef.current.has(hoveredIdRef.current)) {
            startCloseTimer()
          }
        }
      })
    }

    const onClick = e => {
      const hit = hitTest(e.clientX, e.clientY)

      if (hit) {
        e.stopPropagation() // don't let the transcript-background click refocus the composer
        clearOpenTimer()
        clearCloseTimer()
        setPinnedIds(prev => {
          const next = new Set(prev)
          next.add(hit)

          return next
        })

        if (hoveredIdRef.current === hit) {
          setHoveredId(null)
        }
      }
    }

    // Leaving the transcript entirely fires no further mousemove, so dismiss the hover float here too;
    // the float's own mouseenter cancels this, preserving the span -> float bridge.
    const onLeave = () => {
      clearOpenTimer()
      container.style.cursor = ''

      if (hoveredIdRef.current != null && !pinnedIdsRef.current.has(hoveredIdRef.current)) {
        startCloseTimer()
      }
    }

    container.addEventListener('mousemove', onMove)
    container.addEventListener('click', onClick)
    container.addEventListener('mouseleave', onLeave)

    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('click', onClick)
      container.removeEventListener('mouseleave', onLeave)
      container.style.cursor = ''

      if (raf != null) {
        cancelAnimationFrame(raf)
      }
    }
  }, [messagesRef, clearOpenTimer, clearCloseTimer, startCloseTimer])

  // Hover bridge: moving onto the float keeps it open; leaving starts the dismiss timer.
  const handleFloatEnter = useCallback(
    id => {
      clearCloseTimer()
      clearOpenTimer()

      if (hoveredIdRef.current !== id && !pinnedIdsRef.current.has(id)) {
        setHoveredId(id)
      }
    },
    [clearCloseTimer, clearOpenTimer],
  )

  const handleFloatLeave = useCallback(
    id => {
      if (!pinnedIdsRef.current.has(id)) {
        startCloseTimer()
      }
    },
    [startCloseTimer],
  )

  const pin = useCallback(id => {
    setPinnedIds(prev => {
      if (prev.has(id)) {
        return prev
      }

      const next = new Set(prev)
      next.add(id)

      return next
    })
  }, [])

  const handleClose = useCallback(
    id => {
      const reply = unsentRef.current.find(r => r.id === id)

      if (reply && !reply.response.trim()) {
        onRemove(id) // closing an empty unsent reply discards the quote + its highlight
      }

      setPinnedIds(prev => {
        if (!prev.has(id)) {
          return prev
        }

        const next = new Set(prev)
        next.delete(id)

        return next
      })

      if (hoveredIdRef.current === id) {
        setHoveredId(null)
      }
    },
    [onRemove],
  )

  const setFloatRef = useCallback(
    id => el => {
      if (el) {
        floatRefsRef.current.set(id, el)
      } else {
        floatRefsRef.current.delete(id)
      }
    },
    [],
  )

  return [...openIds].map(id => {
    const entry = rangesByIdRef.current.get(id)
    const live = replyById.get(id)

    if (!(entry && live)) {
      return null
    }

    const pos = positions.get(id) ?? { left: -9999, top: -9999 }
    const sourceMoved = !entry.range

    return createPortal(
      <div
        ref={setFloatRef(id)}
        className={`inline-float${sourceMoved ? ' source-moved' : ''}`}
        style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
        onMouseEnter={() => handleFloatEnter(id)}
        onMouseLeave={() => handleFloatLeave(id)}>
        {sourceMoved && <div className="inline-threads-moved">source moved</div>}
        <InlineThread
          reply={live.reply}
          sent={live.sent}
          maxHeight={maxHeight}
          pinned={pinnedIds.has(id)}
          autoFocus={pinnedIds.has(id) && id === focusIdRef.current}
          onEdit={onEditReply}
          onRemove={onRemove}
          onClose={handleClose}
          onFocus={pin}
          onSubmit={onSubmitBatch}
        />
      </div>,
      document.body,
      id,
    )
  })
}
