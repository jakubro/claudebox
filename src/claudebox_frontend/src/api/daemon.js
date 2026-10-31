/** Daemon-level API - the commit the running daemon was started from. */

import { FETCH_TIMEOUT_INTERACTIVE_MS } from '../config/timing'
import { DAEMON_HEALTH_URL } from '../config/urls'

/** Fetch the daemon's commit; null when it cannot say or the request fails. */
export async function fetchDaemonCommit() {
  try {
    const res = await fetch(DAEMON_HEALTH_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_INTERACTIVE_MS),
    })
    if (!res.ok) {
      return null
    }
    const { commit } = await res.json()
    return typeof commit === 'string' ? commit : null
  } catch {
    return null
  }
}
