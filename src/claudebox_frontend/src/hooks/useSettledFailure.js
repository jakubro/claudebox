/** A drawing failure, shown only once the block has stopped changing for the settle window. */

import { useEffect, useState } from 'react'
import { RENDER_FAILURE_NOTICE_DELAY_MS } from '../config/timing'

/**
 * Whether to show the failure notice: true once the same failing source has held for the settle
 * window, so a block still streaming in - each flush a new source - never flashes an error.
 * @param {string|null} failedSource - The source that failed to draw, or null while none has
 * @returns {boolean}
 */
export default function useSettledFailure(failedSource) {
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    setSettled(false)
    if (failedSource === null) {
      return undefined
    }
    const timer = setTimeout(() => setSettled(true), RENDER_FAILURE_NOTICE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [failedSource])

  return settled
}
