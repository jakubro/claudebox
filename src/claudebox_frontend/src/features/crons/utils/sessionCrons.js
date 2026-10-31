/** Pure derivations for the Crons panel's "All sessions" tab. */

import { extractCrons } from '../../../utils/eventProcessing'

/** Return the sources a schedules answer carries, with `respondingSince` in epoch ms. */
export function toScheduleSources(data) {
  return (data?.sessions ?? []).map(s => ({
    sessionId: s.session_id,
    events: s.events,
    respondingSince: s.responding_since ? new Date(s.responding_since).getTime() : null,
  }))
}

/**
 * Return the "All sessions" rows, soonest first, each carrying `sessionId` and its name fields.
 * `own` holds the open session's live rows; while it loads, its copy in `sources` stands in.
 */
export function mergeSessionCrons({ own, sources, now, isRunning, sessionOf }) {
  const rows = []
  const add = (sessionId, crons) => {
    for (const cron of crons) {
      rows.push({ ...cron, sessionId, ...sessionOf(sessionId) })
    }
  }

  for (const { sessionId, events, respondingSince } of sources) {
    const isOwnLive = own && sessionId === own.sessionId && !own.loading
    if (!isOwnLive && isRunning(sessionId)) {
      add(sessionId, extractCrons(events, now, respondingSince))
    }
  }
  if (own && !own.loading && isRunning(own.sessionId)) {
    add(own.sessionId, own.crons)
  }

  return rows.sort((a, b) => a.nextFireAt - b.nextFireAt)
}
