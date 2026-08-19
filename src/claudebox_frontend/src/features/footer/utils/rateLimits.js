/** Pure helpers for the footer's plan-limit items - event parsing, live/expiry checks, copy. */

import { getRateLimitColor } from '../../../utils/color'

// SDK rate_limit_type -> footer window key. seven_day_sonnet/seven_day_opus/overage carry no
// per-model breakdown in the UI and are intentionally left unmapped.
const RATE_LIMIT_TYPE_TO_WINDOW = Object.freeze({
  five_hour: 'session',
  seven_day: 'weekly',
})

const RATE_LIMIT_WINDOW_LABEL = Object.freeze({
  session: 'Session',
  weekly: 'Weekly',
})

export const RATE_LIMIT_WINDOW_ORDER = Object.freeze(['session', 'weekly'])

/** Stored limit entry from a rate_limit event's message_data; null when the type is unmapped. */
export function deriveRateLimitEntry(messageData) {
  const window = messageData && RATE_LIMIT_TYPE_TO_WINDOW[messageData.rate_limit_type]
  if (!window) {
    return null
  }
  return {
    window,
    status: messageData.status,
    utilization: messageData.utilization,
    resetsAt: messageData.resets_at != null ? messageData.resets_at * 1000 : null,
  }
}

/** True while a stored entry should still show - not yet past its own reset time. */
export function isRateLimitEntryLive(entry, now = Date.now()) {
  return entry.resetsAt == null || now < entry.resetsAt
}

/** Footer label: percentage while known ("Session 86%"), "limit reached" once rejected. */
export function formatRateLimitLabel(entry) {
  const label = RATE_LIMIT_WINDOW_LABEL[entry.window]
  if (entry.status === 'rejected') {
    return `${label} limit reached`
  }
  return `${label} ${Math.round((entry.utilization ?? 0) * 100)}%`
}

/** Tooltip copy: window, percentage when known, and the reset time. */
export function formatRateLimitTooltip(entry) {
  const label = RATE_LIMIT_WINDOW_LABEL[entry.window]
  const resetPhrase = entry.resetsAt
    ? `resets ${new Date(entry.resetsAt).toLocaleString()}`
    : 'reset time unknown'
  if (entry.status === 'rejected') {
    return `${label} limit — reached, ${resetPhrase}`
  }
  return `${label} limit — ${Math.round((entry.utilization ?? 0) * 100)}%, ${resetPhrase}`
}

/** Footer item color: red once reached, else the amber-to-red ramp at the known percentage. */
export function getRateLimitItemColor(entry) {
  return getRateLimitColor(entry.status === 'rejected' ? 100 : (entry.utilization ?? 0) * 100)
}
