/** Collapsible system reminders section with deduplication. */

import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { deduplicateWithCounts } from '../../../../../utils/collections'

/**
 * Render deduplicated system reminders in a collapsible section.
 * @param {Object} props
 * @param {string[]} [props.reminders] - Array of reminder strings to display.
 */
export default function SystemReminders({ reminders }) {
  const [expanded, setExpanded] = useState(false)

  const deduplicated = useMemo(
    () => (reminders?.length > 0 ? deduplicateWithCounts(reminders) : []),
    [reminders],
  )

  if (deduplicated.length === 0) {
    return null
  }

  const uniqueCount = deduplicated.length

  return (
    <div className="system-reminders">
      <button
        type="button"
        className="system-reminders-header"
        onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <AlertTriangle size={12} />
        <span className="system-reminders-label">
          System Reminder{uniqueCount > 1 ? 's' : ''} ({uniqueCount})
        </span>
      </button>
      {expanded && (
        <div className="system-reminders-content">
          {deduplicated.map(({ item, count }, i) => (
            <div key={i} className="system-reminder-entry">
              {count > 1 && <span className="system-reminder-count">×{count}</span>}
              <pre className="system-reminder-item">{item.replace(/\\n/g, '\n').trim()}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
