/** Footer item for one plan-limit window (session or weekly), amber-to-red as usage climbs. */

import {
  formatRateLimitLabel,
  formatRateLimitTooltip,
  getRateLimitItemColor,
} from '../utils/rateLimits'

/**
 * @param {object} props.entry - Live entry; owns the trailing separator before the workspace item.
 */
export default function RateLimitItem({ entry }) {
  return (
    <>
      <span
        className="footer-item footer-rate-limit"
        style={{ color: getRateLimitItemColor(entry) }}
        title={formatRateLimitTooltip(entry)}
        data-testid={`footer-rate-limit-${entry.window}`}>
        {formatRateLimitLabel(entry)}
      </span>
      <span className="footer-sep">|</span>
    </>
  )
}
