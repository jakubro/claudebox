/** Owner of per-session state: the routed session, or a creation of this tab named by sequence. */

import { useCallback, useMemo, useRef } from 'react'
import { useSessionId } from '../context/SessionDataContext'
import { useSessionRouting } from '../context/SessionRoutingContext'
import { useStreamingStatus } from '../context/StreamingStatusContext'
import {
  isOrphanedTag,
  isOwnerAttachedFor,
  ownerSessionIdOf,
  ownerTagFor,
  resolveOwnerTag,
} from '../utils/sessionOwnership'

/**
 * The session a piece of per-session state belongs to, decided when it is made. `ownerNow()` reads
 * refs, so it is safe inside event handlers; an owner tag is `{sessionId}` or `{creation}`.
 */
export default function useSessionOwnership() {
  const { activeSessionId } = useSessionRouting()
  const attachedSessionId = useSessionId()
  const { creations, isResumeRequestPending, isCreateRequestPending, getCreation } =
    useStreamingStatus()

  const routedSessionId = activeSessionId ?? null
  const routedRef = useRef(routedSessionId)
  routedRef.current = routedSessionId

  const ownerSessionId = ownerSessionIdOf({ routedSessionId, creations })
  const isOwnerAttached = isOwnerAttachedFor({
    routedSessionId,
    attachedSessionId,
    creations,
    isResumeRequestPending,
    isCreateRequestPending,
  })

  const ownerNow = useCallback(
    () => ownerTagFor({ routedSessionId: routedRef.current, creations: getCreation() }),
    [getCreation],
  )

  const resolveOwner = useCallback(tag => resolveOwnerTag(tag, getCreation()), [getCreation])

  const isRoutedOwner = useCallback(
    tag => {
      const owner = resolveOwnerTag(tag, getCreation())

      return owner !== null && owner === routedRef.current
    },
    [getCreation],
  )

  const isOrphaned = useCallback(tag => isOrphanedTag(tag, getCreation()), [getCreation])

  return useMemo(
    () => ({
      routedSessionId,
      ownerSessionId,
      isOwnerAttached,
      ownerNow,
      resolveOwner,
      isRoutedOwner,
      isOrphaned,
    }),
    [
      routedSessionId,
      ownerSessionId,
      isOwnerAttached,
      ownerNow,
      resolveOwner,
      isRoutedOwner,
      isOrphaned,
    ],
  )
}
