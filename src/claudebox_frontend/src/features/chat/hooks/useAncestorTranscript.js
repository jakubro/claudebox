/** Fetch and derive one session rail ancestor's read-only transcript from its persisted log. */

import { useEffect, useState } from 'react'
import { getSessionEvents } from '../../../api/sessions'
import { flushBatch, initialState } from '../../../context/utils/eventsReducer'
import { computeDuplicateAskUserIds } from '../../../utils/eventProcessing'

const EMPTY_DERIVED = {
  turns: [],
  turnResults: {},
  taskNotifications: new Map(),
  todoDiffs: new Map(),
  duplicateAskUserIds: new Set(),
}

/**
 * Read a session's persisted events via the read-only route - no container needed - and derive the
 * live pipeline's shape with one `flushBatch`. Unreadable directories resolve to 'unavailable'.
 */
export default function useAncestorTranscript(sessionId) {
  const [state, setState] = useState(() => ({ status: 'loading', ...EMPTY_DERIVED }))

  useEffect(() => {
    if (!sessionId) {
      setState({ status: 'unavailable', ...EMPTY_DERIVED })
      return undefined
    }

    let cancelled = false
    setState({ status: 'loading', ...EMPTY_DERIVED })

    getSessionEvents(sessionId)
      .then(({ events }) => {
        if (cancelled) {
          return
        }

        const derived = flushBatch(initialState, events)
        setState({
          status: 'ready',
          turns: derived.turns,
          turnResults: derived.turnResults,
          taskNotifications: derived.taskNotifications,
          todoDiffs: derived.todoDiffs,
          duplicateAskUserIds: computeDuplicateAskUserIds(derived.turns),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'unavailable', ...EMPTY_DERIVED })
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  return state
}
