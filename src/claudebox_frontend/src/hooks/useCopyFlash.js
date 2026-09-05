/** Copy text to clipboard and flash a "Copied!" indicator briefly. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { COPY_FEEDBACK_MS } from '../config/timing'

/**
 * Returns `[copied, copy]`; `copied` resets after `durationMs` ms (default `COPY_FEEDBACK_MS`).
 *
 * @param {{ durationMs?: number }} [options]
 * @returns {readonly [boolean, (text: string | null | undefined) => void]}
 */
export default function useCopyFlash({ durationMs = COPY_FEEDBACK_MS } = {}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  // An uncancelled reset lands in a tree that is gone: a state update on an unmounted component
  // in the app, and an uncaught ReferenceError once a test environment has been torn down.
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const copy = useCallback(
    text => {
      if (!text) {
        return
      }
      navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), durationMs)
    },
    [durationMs],
  )

  return [copied, copy]
}
