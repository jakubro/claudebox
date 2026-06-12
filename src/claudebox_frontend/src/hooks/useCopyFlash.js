/** Copy text to clipboard and flash a "Copied!" indicator briefly. */

import { useCallback, useState } from 'react'
import { COPY_FEEDBACK_MS } from '../config/timing'

/**
 * Manage a transient copy-confirmation flag and a copy-to-clipboard handler.
 *
 * Returns `[copied, copy]` - render `copied ? 'Copied!' : ...` and call
 * `copy(text)` when the user triggers the action. The flag flips back to false
 * after `COPY_FEEDBACK_MS` (or `durationMs` when supplied).
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
