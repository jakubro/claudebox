/** Owner rules for per-session state: the routed session, or a creation named by its sequence. */

/** The creation still open for this tab: pending, or created but not yet reached by the route. */
export function openCreation(creations, routedSessionId) {
  const entry = creations.bySeq[creations.current]

  if (!entry) {
    return null
  }

  const open =
    entry.status === 'pending' ||
    (entry.status === 'created' &&
      entry.sessionId !== routedSessionId &&
      entry.fromRoute === routedSessionId)

  return open ? { seq: creations.current, ...entry } : null
}

/** The owner session now: an open creation's session once created, else the routed one. */
export function ownerSessionIdOf({ routedSessionId, creations }) {
  const creation = openCreation(creations, routedSessionId)

  if (creation) {
    return creation.sessionId
  }

  return routedSessionId ?? null
}

/** Whether the owner is the attached session, with no open or create request still in flight. */
export function isOwnerAttachedFor({
  routedSessionId,
  attachedSessionId,
  creations,
  isResumeRequestPending,
  isCreateRequestPending,
}) {
  if (isResumeRequestPending || isCreateRequestPending) {
    return false
  }

  const owner = ownerSessionIdOf({ routedSessionId, creations })

  return owner !== null && owner === attachedSessionId
}

/** The owner tag for state made now; on the welcome screen it names the next creation. */
export function ownerTagFor({ routedSessionId, creations }) {
  const creation = openCreation(creations, routedSessionId)

  if (creation) {
    return { creation: creation.seq }
  }

  if (routedSessionId) {
    return { sessionId: routedSessionId }
  }

  return { creation: creations.current + 1 }
}

/** The session a tag names, or null while its creation has produced none. */
export function resolveOwnerTag(tag, creations) {
  if (!tag) {
    return null
  }

  if (tag.sessionId !== undefined) {
    return tag.sessionId
  }

  const entry = creations.bySeq[tag.creation]

  return entry && (entry.status === 'created' || entry.status === 'routed') ? entry.sessionId : null
}

/** Whether a tag names a creation that failed. */
export function isOrphanedTag(tag, creations) {
  return tag?.creation !== undefined && creations.bySeq[tag.creation]?.status === 'failed'
}

/** Whether view state opened for a routed session (null when closed) is open on `routedSessionId`. */
export function isOpenFor(openedFor, routedSessionId) {
  return openedFor !== null && openedFor === routedSessionId
}

/** Close view state open on `routedSessionId`, or open it there. */
export function toggleOpenFor(openedFor, routedSessionId) {
  return isOpenFor(openedFor, routedSessionId) ? null : routedSessionId
}
