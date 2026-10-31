/** Combined badge counts from multiple contexts. */

import { useMemo } from 'react'
import { CRON_BADGE_REFRESH_MS } from '../../../config/timing'
import { useEvents } from '../../../context/EventsContext'
import { useLogsStream } from '../../../context/LogsStreamContext'
import { useStash } from '../../../context/StashContext'
import useNow from '../../../hooks/useNow'
import { computeBadgeCounts } from '../utils/badgeCounts'

export default function useBadgeCounts() {
  const {
    events,
    todosBySubagent,
    taskNotifications,
    backgroundLaunches,
    isResponding,
    respondingSince,
  } = useEvents()
  const { stash } = useStash()
  const { hasUnreadErrors } = useLogsStream()

  // A schedule firing or expiring produces no event, so the count needs a clock of its own.
  const now = useNow(CRON_BADGE_REFRESH_MS)
  const turnStartedAt = isResponding ? respondingSince : null

  return useMemo(
    () =>
      computeBadgeCounts({
        events,
        todosBySubagent,
        taskNotifications,
        backgroundLaunches,
        now,
        turnStartedAt,
        stash,
        hasUnreadErrors,
      }),
    [
      events,
      todosBySubagent,
      taskNotifications,
      backgroundLaunches,
      now,
      turnStartedAt,
      stash,
      hasUnreadErrors,
    ],
  )
}
