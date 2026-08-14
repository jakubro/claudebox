/** Copy text to clipboard and flash a "Copied!" indicator briefly. */

import { useCallback, useState } from 'react'
import { COPY_FEEDBACK_MS } from '../config/timing'

/**
 * Returns `[copied, copy]`; `copied` resets after `durationMs` ms (default `COPY_FEEDBACK_MS`).
 *
 * @param {{ durationMs?: number }} [options]
 * @returns {readonly [boolean, (text: string | null | undefined) => void]}
 */
export default function useCopyFlash({ durationMs = COPY_FEEDBACK_MS } = {}) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    text => {
      if (!text) {
        return
      }
      navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), durationMs)
    },
    [durationMs],
  )

  return [copied, copy]
}
