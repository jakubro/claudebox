/** At-bottom-only autoscroll shared by every append-only scrollable log/entry list. */

import { useCallback, useEffect, useRef } from 'react'
import { AUTOSCROLL_THRESHOLD } from '../config/dimensions'

/**
 * Scrolls to the bottom when `content` changes identity, but only while the user is still at or
 * near the bottom. `isProgrammaticScroll` keeps `handleScroll` from re-enabling off its own write.
 */
export function useBottomAutoscroll(content) {
  const scrollRef = useRef(null)
  const isAutoScrollEnabled = useRef(true)
  const isProgrammaticScroll = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: content triggers scroll on new/updated entries
  useEffect(() => {
    if (isAutoScrollEnabled.current && scrollRef.current) {
      isProgrammaticScroll.current = true
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      requestAnimationFrame(() => {
        isProgrammaticScroll.current = false
      })
    }
  }, [content])

  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current || !scrollRef.current) {
      return
    }
    const { scrollHeight, scrollTop, clientHeight } = scrollRef.current
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    isAutoScrollEnabled.current = distanceFromBottom <= AUTOSCROLL_THRESHOLD
  }, [])

  return { scrollRef, handleScroll }
}
