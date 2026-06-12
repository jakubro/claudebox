/** Usage cost aggregation utilities. */

export const INTERVALS = [
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'All time', ms: Infinity },
]

/**
 * Aggregate cost from sessions within a time interval.
 *
 * Each session contributes only its post-fork delta: its full reported cost
 * minus the fork-point snapshot. Root sessions have a zero snapshot so they
 * contribute their full cost; forks contribute only what they accrued past
 * the inherited transcript, avoiding double-counting against the ancestor.
 */
export function aggregateCost(sessions, intervalMs) {
  const cutoff = intervalMs === Infinity ? 0 : Date.now() - intervalMs
  return sessions
    .filter(s => new Date(s.started_at).getTime() >= cutoff)
    .reduce((sum, s) => sum + (s.total_cost_usd || 0) - s.fork_point_cost_usd, 0)
}
