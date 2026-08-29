/** Best-effort frontend failure reporting to the daemon log. */

import { ERROR_REPORT_DEDUP_WINDOW_MS, FETCH_TIMEOUT_INTERACTIVE_MS } from '../config/timing'
import { DAEMON_REPORT_URL } from '../config/urls'

const _recentSignatures = new Map()

/**
 * Reports a frontend failure to the daemon log, deduplicated by kind+message within a time window;
 * never throws or retries so a down/slow daemon can't cause a second failure.
 * @param {object} report
 * @param {string} report.kind - What broke (e.g. "render-failure", "persistence-failure").
 * @param {string} report.message - Identifies the failure - never message text or draft content.
 * @param {string} [report.stack] - JS or component stack trace.
 */
export function reportError({ kind, message, stack }) {
  const signature = `${kind}:${message}`
  const now = Date.now()
  const last = _recentSignatures.get(signature)

  if (last && now - last < ERROR_REPORT_DEDUP_WINDOW_MS) {
    return
  }
  _recentSignatures.set(signature, now)

  fetch(DAEMON_REPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      message,
      stack_trace: stack ?? null,
      app_version: null,
      client_timestamp: new Date().toISOString(),
    }),
    // Bare fetch, not retryFetch: this must not retry. The bound only stops an unanswered report
    // from holding a connection slot against the origin for the life of the page.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_INTERACTIVE_MS),
  }).catch(() => {
    // Intentional: reporting is best-effort and must not itself become a failure.
  })
}
