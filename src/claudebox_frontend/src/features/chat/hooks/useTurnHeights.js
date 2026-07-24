/** Per-turn height tracker for minimap proportionality - sticky cache + content predictor + idle warmup. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { INTRINSIC_TURN_HEIGHT_PX, TURN_HORIZONTAL_PADDING_PX } from '../../../config/dimensions'
import { STREAMING_THROTTLE_MS } from '../../../config/timing'
import { predictTurnHeight } from '../utils/predictTurnHeight'
import { scheduleIdleWarmup } from '../utils/turnHeightWarmup'

const EMPTY_HEIGHTS = {}
const EMPTY_SET = new Set()

/**
 * Return turn and user-message heights for minimap proportional display.
 *
 * Sticky cache keyed by `data-turn-id`. First on-screen observation stores the
 * real measurement; first off-screen observation stores a content-derived
 * prediction so the cache never locks at the 400px content-visibility:auto
 * placeholder. Subsequent off-screen fires never overwrite the cache;
 * subsequent on-screen fires refresh (turns grow while streaming; predictions
 * upgrade to reality on first visit). Pending turns lack a `data-turn-id` and
 * are reported live - they sit at the bottom and are always on-screen.
 *
 * Idle-time warmup walks predicted off-screen turn chunks, applies a
 * `.force-measure` opt-out class, reads `offsetHeight` (forces real layout
 * under `content-visibility: visible`), then removes the class - replacing
 * predictions with measurements without paint cost. Defers during streaming
 * via `isStreamingRef`.
 *
 * `getLogicalScrollHeight` returns a stable scroll-axis total derived from
 * the cache. Consumed by MinimapController for thumb-size jitter resistance
 * (position uses native `containerEl.scrollHeight`). The result is memoized
 * on a cache-version counter - repeated calls between cache mutations are
 * O(1) instead of a fresh querySelectorAll + per-turn iteration.
 */
export default function useTurnHeights(
  messagesRef,
  turns,
  isStreaming = false,
  collapsedTurnIds = EMPTY_SET,
) {
  const [heights, setHeights] = useState(EMPTY_HEIGHTS)
  const [userHeights, setUserHeights] = useState(EMPTY_HEIGHTS)
  const resizeObserverRef = useRef(null)
  const intersectionObserverRef = useRef(null)
  const elementsRef = useRef(new Map())
  // turnEl -> user-message child element. Cached on first observation so the
  // per-update `querySelector` in updateHeights becomes a Map lookup.
  const userElementsRef = useRef(new Map())
  // turnId -> {height, userHeight, predicted}: sticky cache of last trusted measurement
  const cacheRef = useRef(new Map())
  // turnIds currently intersecting the chat viewport
  const onScreenRef = useRef(new Set())
  // Latest turns array, accessed by predictor without re-firing observer effects
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming
  // Latest collapsed-turn-id set mirrored to a ref so isCollapsed reads it without
  // re-subscribing observers or destabilizing updateHeights / getLogicalScrollHeight.
  const collapsedIdsRef = useRef(collapsedTurnIds)
  collapsedIdsRef.current = collapsedTurnIds
  const isCollapsed = useCallback(turnId => collapsedIdsRef.current.has(turnId), [])
  // Warmup guard - prevents double-scheduling within a single effect run. Reset
  // on cleanup so a preempted run can restart (see the warmup effect).
  const warmupActiveRef = useRef(false)
  // Memo plumbing for getLogicalScrollHeight: bump cacheVersionRef whenever
  // cacheRef or the observed DOM changes. memoVersionRef tracks the version
  // at which memoResultRef was computed; equal versions = cache hit.
  const cacheVersionRef = useRef(0)
  const memoVersionRef = useRef(-1)
  const memoResultRef = useRef(0)

  // Track the actual DOM element so the observer effect re-runs when it appears.
  const [containerEl, setContainerEl] = useState(null)
  const currentEl = messagesRef?.current ?? null
  if (currentEl !== containerEl) {
    setContainerEl(currentEl)
  }

  const readTurnId = useCallback(el => el.getAttribute?.('data-turn-id') || null, [])

  /** Compute effective text-column width for the predictor (clientWidth minus turn padding). */
  const effectiveWidthFor = useCallback(container => {
    const width = container?.clientWidth || 0
    return Math.max(0, width - TURN_HORIZONTAL_PADDING_PX)
  }, [])

  /** Look up the cached user-message element for a turn, re-querying only if stale. */
  const findUserEl = useCallback(turnEl => {
    let userEl = userElementsRef.current.get(turnEl)
    // Real DOM exposes .contains() to detect a detached cache entry; mocks
    // and exotic hosts may not, in which case we trust the cache until the
    // turn element itself is pruned from elementsRef.
    const stale = userEl && typeof turnEl.contains === 'function' && !turnEl.contains(userEl)
    if (!userEl || stale) {
      userEl = turnEl.querySelector('[data-testid="message-user"]')
      if (userEl) {
        userElementsRef.current.set(turnEl, userEl)
      } else {
        userElementsRef.current.delete(turnEl)
      }
    }
    return userEl
  }, [])

  /** Stable scroll-axis total: sum of cached heights with prediction fallback. */
  const getLogicalScrollHeight = useCallback(() => {
    const container = messagesRef?.current
    if (!container) {
      return 0
    }
    if (cacheVersionRef.current === memoVersionRef.current) {
      return memoResultRef.current
    }
    const effectiveWidth = effectiveWidthFor(container)
    const turnElements = container.querySelectorAll('[data-testid="turn-container"]')
    let total = 0
    for (const el of turnElements) {
      const turnId = readTurnId(el)
      const cached = turnId ? cacheRef.current.get(turnId) : null
      if (cached) {
        total += cached.height
      } else if (turnId) {
        const turn = turnsRef.current?.find(t => t.turn_id === turnId)
        total += turn
          ? predictTurnHeight(turn, effectiveWidth, isCollapsed(turnId))
          : INTRINSIC_TURN_HEIGHT_PX
      } else {
        // Pending turn (no turnId) - always on-screen at bottom, trust live measure.
        total += el.offsetHeight
      }
    }
    memoResultRef.current = total
    memoVersionRef.current = cacheVersionRef.current
    return total
  }, [messagesRef, readTurnId, effectiveWidthFor, isCollapsed])

  // Update heights from observed elements, applying sticky cache.
  // `fastPath`: skip the O(N) sweep and re-measure only the bottom turn -
  // used during streaming where only the active turn grows. Other turns
  // can't resize without firing their own ResizeObserver (which would
  // schedule its own update), so the cache for non-active turns remains
  // authoritative.
  const updateHeights = useCallback(
    (options = {}) => {
      const container = messagesRef?.current
      if (!container) {
        return
      }

      const { fastPath = false } = options
      const turnElements = container.querySelectorAll('[data-testid="turn-container"]')

      if (fastPath && turnElements.length > 0) {
        const el = turnElements[turnElements.length - 1]
        const turnId = readTurnId(el)
        const measuredHeight = el.offsetHeight
        const userEl = findUserEl(el)
        const measuredUserHeight = userEl ? userEl.offsetHeight : 0

        if (!turnId) {
          // Pending turn (no data-turn-id) is not a minimap segment; nothing to export.
          return
        }

        if (onScreenRef.current.has(turnId)) {
          const prev = cacheRef.current.get(turnId)
          if (
            !prev ||
            prev.height !== measuredHeight ||
            prev.userHeight !== measuredUserHeight ||
            prev.predicted
          ) {
            cacheRef.current.set(turnId, {
              height: measuredHeight,
              userHeight: measuredUserHeight,
              predicted: false,
            })
            cacheVersionRef.current += 1
          }
        }

        let changed = false
        setHeights(prev => {
          if (prev[turnId] === measuredHeight) {
            return prev
          }
          changed = true
          return { ...prev, [turnId]: measuredHeight }
        })
        setUserHeights(prev => {
          if (prev[turnId] === measuredUserHeight) {
            return prev
          }
          changed = true
          return { ...prev, [turnId]: measuredUserHeight }
        })
        if (changed) {
          cacheVersionRef.current += 1
        }
        return
      }

      const newHeights = {}
      const newUserHeights = {}
      const currentTurnIds = new Set()
      const effectiveWidth = effectiveWidthFor(container)
      let cacheTouched = false

      for (const el of turnElements) {
        const turnId = readTurnId(el)
        // Pending turn (no data-turn-id) is not a minimap segment; skip export.
        if (!turnId) {
          continue
        }
        const measuredHeight = el.offsetHeight
        const userEl = findUserEl(el)
        const measuredUserHeight = userEl ? userEl.offsetHeight : 0

        currentTurnIds.add(turnId)
        const cached = cacheRef.current.get(turnId)
        const isOnScreen = onScreenRef.current.has(turnId)
        if (!cached) {
          if (isOnScreen) {
            // On-screen first observation - measurement is the real layout.
            cacheRef.current.set(turnId, {
              height: measuredHeight,
              userHeight: measuredUserHeight,
              predicted: false,
            })
          } else {
            // Off-screen first observation - offsetHeight may be the 400px
            // intrinsic-size placeholder. Cache the prediction instead so
            // the minimap reflects content shape from frame 1; idle warmup
            // upgrades to real measurement later.
            const turn = turnsRef.current?.find(t => t.turn_id === turnId)
            cacheRef.current.set(turnId, {
              height: predictTurnHeight(turn, effectiveWidth, isCollapsed(turnId)),
              userHeight: 0,
              predicted: true,
            })
          }
          cacheTouched = true
        } else if (isOnScreen) {
          // Refresh while visible: streaming growth, or prediction upgrade on first scroll-in.
          if (
            cached.height !== measuredHeight ||
            cached.userHeight !== measuredUserHeight ||
            cached.predicted
          ) {
            cacheRef.current.set(turnId, {
              height: measuredHeight,
              userHeight: measuredUserHeight,
              predicted: false,
            })
            cacheTouched = true
          }
        }
        const entry = cacheRef.current.get(turnId)
        // Export keyed by stable turnId (the minimap reads turnHeights[group.turn_id]);
        // an index key would misalign turns when the groups array reorders, e.g. a
        // compaction dropping an earlier turn.
        newHeights[turnId] = entry.height
        newUserHeights[turnId] = entry.userHeight
      }

      // Prune cache entries for turns no longer in the DOM (rewind, fork-here).
      for (const turnId of cacheRef.current.keys()) {
        if (!currentTurnIds.has(turnId)) {
          cacheRef.current.delete(turnId)
          onScreenRef.current.delete(turnId)
          cacheTouched = true
        }
      }

      let dimChanged = false
      setHeights(prev => {
        const hasChanges =
          Object.keys(newHeights).length !== Object.keys(prev).length ||
          Object.entries(newHeights).some(([k, v]) => prev[k] !== v)
        if (hasChanges) {
          dimChanged = true
        }
        return hasChanges ? newHeights : prev
      })

      setUserHeights(prev => {
        const hasChanges =
          Object.keys(newUserHeights).length !== Object.keys(prev).length ||
          Object.entries(newUserHeights).some(([k, v]) => prev[k] !== v)
        if (hasChanges) {
          dimChanged = true
        }
        return hasChanges ? newUserHeights : prev
      })

      if (cacheTouched || dimChanged) {
        cacheVersionRef.current += 1
      }
    },
    [messagesRef, readTurnId, effectiveWidthFor, findUserEl, isCollapsed],
  )

  // Setup observers - re-runs when containerEl changes.
  useEffect(() => {
    if (!containerEl) {
      return
    }

    let rafId = null
    let throttleTimer = null
    let lastStreamingFlush = 0

    const runFull = needsObserve => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(() => {
        rafId = null
        updateHeights()
        if (needsObserve) {
          observeTurns()
        }
      })
    }

    const runStreamingFast = () => {
      throttleTimer = null
      lastStreamingFlush = Date.now()
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(() => {
        rafId = null
        updateHeights({ fastPath: true })
      })
    }

    // Structural change -> run full pass on next frame; re-observe new turns.
    // ResizeObserver-triggered update during streaming -> trailing-edge throttle
    // to STREAMING_THROTTLE_MS so the active turn's continuous growth doesn't
    // drive a layout pass on every flush. Idle ResizeObserver -> next-frame
    // coalescing as before.
    const scheduleUpdate = needsObserve => {
      if (needsObserve) {
        runFull(true)
        return
      }
      if (isStreamingRef.current) {
        if (throttleTimer) {
          return
        }
        const elapsed = Date.now() - lastStreamingFlush
        const delay = Math.max(0, STREAMING_THROTTLE_MS - elapsed)
        throttleTimer = setTimeout(runStreamingFast, delay)
        return
      }
      runFull(false)
    }

    // Narrowed to `subtree: false`: turn insertions/removals fire at the
    // container level; in-place growth of an existing turn is delivered by
    // ResizeObserver instead. With `subtree: true` every streamed token
    // mutation inside a turn would also trip a full pass.
    const mutationObserver = new MutationObserver(() => {
      scheduleUpdate(true)
    })
    mutationObserver.observe(containerEl, { childList: true, subtree: false })

    resizeObserverRef.current = new ResizeObserver(() => {
      scheduleUpdate(false)
    })

    intersectionObserverRef.current = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const turnId = readTurnId(entry.target)
          if (!turnId) {
            continue
          }
          if (entry.isIntersecting) {
            onScreenRef.current.add(turnId)
          } else {
            onScreenRef.current.delete(turnId)
          }
        }
      },
      { root: containerEl, threshold: 0 },
    )

    const observeTurns = () => {
      const turnElements = containerEl.querySelectorAll('[data-testid="turn-container"]')
      const currentElements = new Set(elementsRef.current.keys())

      for (const el of turnElements) {
        if (!elementsRef.current.has(el)) {
          resizeObserverRef.current?.observe(el)
          intersectionObserverRef.current?.observe(el)
          elementsRef.current.set(el, true)
        }
        currentElements.delete(el)
      }

      for (const el of currentElements) {
        resizeObserverRef.current?.unobserve(el)
        intersectionObserverRef.current?.unobserve(el)
        elementsRef.current.delete(el)
        userElementsRef.current.delete(el)
      }
    }

    observeTurns()
    updateHeights()

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      if (throttleTimer) {
        clearTimeout(throttleTimer)
      }
      mutationObserver.disconnect()
      resizeObserverRef.current?.disconnect()
      intersectionObserverRef.current?.disconnect()
      elementsRef.current.clear()
      userElementsRef.current.clear()
    }
  }, [containerEl, updateHeights, readTurnId])

  // Idle-time warmup: replace predicted entries with real measurements. Each run
  // owns a fresh stop token and clears the active guard on cleanup, so a run
  // preempted by a turns.length change or by streaming stops cleanly and the next
  // run restarts. A single shared stop flag would stay set after the first
  // preemption and block every later warmup, stranding off-screen turns on their
  // predictions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns.length triggers re-warmup on growth
  useEffect(() => {
    if (!containerEl || warmupActiveRef.current) {
      return
    }
    warmupActiveRef.current = true
    const shouldStopRef = { current: false }
    scheduleIdleWarmup({
      containerEl,
      cacheRef,
      onScreenRef,
      isStreamingRef,
      shouldStopRef,
      onCacheUpdate: updateHeights,
      onComplete: () => {
        warmupActiveRef.current = false
      },
    })
    return () => {
      shouldStopRef.current = true
      warmupActiveRef.current = false
    }
  }, [containerEl, turns.length, updateHeights])

  // Re-observe when turn count changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns.length triggers update
  useEffect(() => {
    updateHeights()
  }, [turns.length, updateHeights])

  // Collapse/expand is an authoritative resize even off-screen, where
  // content-visibility hides it from the ResizeObserver and the on-screen refresh
  // gate. Rewrite the cache for each turn whose collapsed flag flipped; scoped to
  // flips, so the never-shrink-on-scroll-past guard for expanded turns is untouched.
  const prevCollapsedIdsRef = useRef(collapsedTurnIds)
  useEffect(() => {
    const prev = prevCollapsedIdsRef.current
    prevCollapsedIdsRef.current = collapsedTurnIds
    const container = messagesRef?.current
    if (!container) {
      return
    }
    const flipped = []
    for (const id of collapsedTurnIds) {
      if (!prev.has(id)) {
        flipped.push(id)
      }
    }
    for (const id of prev) {
      if (!collapsedTurnIds.has(id)) {
        flipped.push(id)
      }
    }
    if (flipped.length === 0) {
      return
    }
    const effectiveWidth = effectiveWidthFor(container)
    let touched = false
    for (const turnId of flipped) {
      const turn = turnsRef.current?.find(t => t.turn_id === turnId)
      if (!turn) {
        continue
      }
      cacheRef.current.set(turnId, {
        height: predictTurnHeight(turn, effectiveWidth, collapsedTurnIds.has(turnId)),
        userHeight: 0,
        predicted: true,
      })
      touched = true
    }
    if (touched) {
      cacheVersionRef.current += 1
      updateHeights()
    }
  }, [collapsedTurnIds, messagesRef, effectiveWidthFor, updateHeights])

  return { turnHeights: heights, userMessageHeights: userHeights, getLogicalScrollHeight }
}
