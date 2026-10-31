/** Usage panel showing total cost aggregated over time intervals. */

import { useMemo } from 'react'
import { RELATIVE_TIME_TICK_MS } from '../../config/timing'
import { useSessionsList } from '../../context/SessionsContext'
import useNow from '../../hooks/useNow'
import { formatCost } from '../../utils/formatters'
import { aggregateCost, INTERVALS } from './utils/aggregation'

export default function UsagePanel() {
  const { sessions } = useSessionsList()
  const now = useNow(RELATIVE_TIME_TICK_MS)

  const costs = useMemo(
    () =>
      INTERVALS.map(({ label, ms }) => ({
        label,
        cost: aggregateCost(sessions, ms, now),
      })),
    [sessions, now],
  )

  return (
    <div className="usage-panel" data-testid="panel-usage">
      <table className="usage-table">
        <tbody>
          {costs.map(({ label, cost }) => (
            <tr key={label}>
              <td className="usage-label">{label}</td>
              <td className="usage-cost">{formatCost(cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
