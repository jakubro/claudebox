/** Own a right-slot column's scroll position: initial landing, replay settle, intent latch. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { SCROLL_SETTLE_MAX_FRAMES } from '../../../config/timing'
import ColumnScrollController from '../components/ColumnScrollController'

/**
 * One scroll owner per right-slot column: a stable controller, a reactive flag for the control
 * bar, and a ref for scroll-frame readers. The column itself owns no scroll authority.
 *
 * @param {string|null} sessionId - Resets the latch and lands at the bottom on change.
 * @param {boolean} isReplaying - True while replay drains; the settle loop holds until it clears.
 * @param {boolean} isVisible - Whether this column is mounted; a column turned on mid-session
 *   lands at its newest entry when this flips.
 * @param {string} columnKey - Names the column for the dev-only inspection global below.
 */
export default function useColumnScroll(sessionId, isReplaying, isVisible, columnKey) {
  const containerRef = useRef(null)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)
  const isAutoScrollEnabledRef = useRef(true)

  const controllerRef = useRef(null)
  if (!controllerRef.current) {
    controllerRef.current = new ColumnScrollController({
      onAutoScrollChange: enabled => {
        isAutoScrollEnabledRef.current = enabled
        setIsAutoScrollEnabled(enabled)
      },
    })
    // Exposed for repro/verify scripts reading state directly; DEV-gated out of prod. One key per
    // column so a script can address either instance instead of whichever mounted last.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window[`__${columnKey}_scroll_controller__`] = controllerRef.current
    }
  }
  const controller = controllerRef.current

  // sessionId re-attaches on a session change; isVisible re-attaches once the conditionally-
  // rendered container first mounts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-attach triggers
  useEffect(() => {
    if (!containerRef.current) {
      return undefined
    }
    controller.initialize(containerRef.current)
    controller.attachInputListeners(containerRef.current)
    return () => controller.dispose()
  }, [controller, sessionId, isVisible])

  // Lands at the bottom with autoscroll engaged on a session change, and whenever the column
  // becomes visible - a fresh container mounts at offset zero and would otherwise stay there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId and isVisible are deliberate triggers
  useEffect(() => {
    controller.reset()
    controller.scrollToBottom()
  }, [sessionId, isVisible, controller])

  // Entries arrive across many commits while replay drains and the scroll mirror starts null, so
  // re-scroll every frame until height stops growing, capped so an animation can't stall it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: isReplaying is a deliberate trigger (see below)
  useEffect(() => {
    if (isReplaying) {
      return undefined
    }

    let id
    let framesLeft = SCROLL_SETTLE_MAX_FRAMES
    let lastHeight = -1
    let lastScrollTop = -1
    const settle = () => {
      const el = containerRef.current
      if (!el) {
        return
      }
      if (lastScrollTop >= 0 && el.scrollTop < lastScrollTop) {
        return
      }
      controller.scrollToBottom()
      framesLeft -= 1
      lastScrollTop = el.scrollTop
      const height = el.scrollHeight
      if (framesLeft > 0 && height !== lastHeight) {
        lastHeight = height
        id = requestAnimationFrame(settle)
      }
    }
    id = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(id)
  }, [sessionId, isReplaying, controller])

  const handleScroll = useCallback(() => controller.handleScroll(), [controller])
  const scrollToBottom = useCallback(() => controller.scrollToBottom(), [controller])
  const markUserIntent = useCallback(() => controller.markUserIntent(), [controller])
  const markReturnedToBottom = useCallback(() => controller.markReturnedToBottom(), [controller])
  const markProgrammaticScroll = useCallback(
    () => controller.markProgrammaticScroll(),
    [controller],
  )

  return {
    containerRef,
    isAutoScrollEnabled,
    isAutoScrollEnabledRef,
    handleScroll,
    scrollToBottom,
    markUserIntent,
    markReturnedToBottom,
    markProgrammaticScroll,
  }
}
