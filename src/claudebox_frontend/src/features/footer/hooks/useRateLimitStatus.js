/** Live plan-limit entries for the footer - server-owned, per workspace. */

import { useEffect, useState } from 'react'
import { RATE_LIMITS_STORAGE_KEY } from '../../../config/storage'
import { RATE_LIMIT_SWEEP_INTERVAL_MS } from '../../../config/timing'
import { useSessionData } from '../../../context/SessionDataContext'
import useSessionDefaults from '../../../hooks/useSessionDefaults'
import {
  deriveRateLimitEntry,
  isRateLimitEntryLive,
  RATE_LIMIT_WINDOW_ORDER,
} from '../utils/rateLimits'

/**
 * Source order: in-session `sessionData.rate_limits` first, then workspace `session-defaults`
 * (pre-session welcome screen) - same fallback shape as useCapabilities. A periodic tick clears
 * an entry once its own reset time passes, since nothing else re-renders an idle footer.
 */
export default function useRateLimitStatus() {
  const { rateLimits } = useSessionData()
  const sessionDefaults = useSessionDefaults()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), RATE_LIMIT_SWEEP_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    localStorage.removeItem(RATE_LIMITS_STORAGE_KEY)
  }, [])

  const raw = rateLimits || sessionDefaults?.rate_limits || []
  const byWindow = {}

  for (const payload of raw) {
    const entry = deriveRateLimitEntry(payload)
    if (entry) {
      byWindow[entry.window] = entry
    }
  }

  return RATE_LIMIT_WINDOW_ORDER.map(window => byWindow[window]).filter(
    entry => entry && isRateLimitEntryLive(entry, now),
  )
}
