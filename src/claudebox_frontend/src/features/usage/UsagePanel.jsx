/** Usage panel showing total cost aggregated over time intervals. */

import { useMemo } from 'react'
import { useSessionsList } from '../../context/SessionsContext'
import { formatCost } from '../../utils/formatters'
import { aggregateCost, INTERVALS } from './utils/aggregation'

/** Render usage panel consuming shared sessions from SessionsContext. */
export default function UsagePanel() {
  const { sessions } = useSessionsList()

  const costs = useMemo(
    () =>
      INTERVALS.map(({ label, ms }) => ({
        label,
        cost: aggregateCost(sessions, ms),
      })),
    [sessions],
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
