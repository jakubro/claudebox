/** Combined badge counts from multiple contexts. */

import { useMemo } from 'react'
import { useEvents } from '../../../context/EventsContext'
import { useLogsStream } from '../../../context/LogsStreamContext'
import { useStash } from '../../../context/StashContext'
import { computeBadgeCounts } from '../utils/badgeCounts'

/** Return badge counts and dot flags for sidebar icons from multiple contexts. */
export default function useBadgeCounts() {
  const { events, todosBySubagent, taskNotifications } = useEvents()
  const { stash } = useStash()
  const { hasUnreadErrors } = useLogsStream()

  return useMemo(
    () =>
      computeBadgeCounts({
        events,
        todosBySubagent,
        taskNotifications,
        stash,
        hasUnreadErrors,
      }),
    [events, todosBySubagent, taskNotifications, stash, hasUnreadErrors],
  )
}
