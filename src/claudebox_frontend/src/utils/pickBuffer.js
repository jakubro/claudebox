/** What becomes of picker changes made before their session is on screen. */

export const PickFate = Object.freeze({
  WAIT: 'wait',
  DRAIN: 'drain',
  DISCARD: 'discard',
  REBIND: 'rebind',
})

/** Whether two owner tags name the same owner. */
export function sameOwner(a, b) {
  if (a.sessionId !== undefined || b.sessionId !== undefined) {
    return a.sessionId === b.sessionId
  }

  return a.creation === b.creation
}

/**
 * Decide a buffer's fate: drain into its owner once attached, discard on any other attach or a
 * workspace change, move to the next creation when its own failed, else wait.
 */
export function pickBufferFate(
  pending,
  { workspaceId, routedSessionId, attachedSessionId, isOwnerAttached, creations },
) {
  if (pending.workspaceId !== workspaceId) {
    return PickFate.DISCARD
  }

  const { owner } = pending

  if (owner.sessionId !== undefined) {
    if (routedSessionId !== owner.sessionId) {
      return PickFate.DISCARD
    }

    return isOwnerAttached && attachedSessionId === owner.sessionId ? PickFate.DRAIN : PickFate.WAIT
  }

  const entry = creations.bySeq[owner.creation]

  if (!entry) {
    return attachedSessionId ? PickFate.DISCARD : PickFate.WAIT
  }

  if (entry.status === 'pending') {
    return PickFate.WAIT
  }

  if (entry.status === 'failed') {
    return PickFate.REBIND
  }

  if (attachedSessionId === entry.sessionId) {
    return isOwnerAttached ? PickFate.DRAIN : PickFate.WAIT
  }

  return attachedSessionId ? PickFate.DISCARD : PickFate.WAIT
}

/** Whether a buffer carries a setting to apply (a bundle alone is read by the creation, not applied). */
export function hasSettings(picks) {
  return Boolean(picks && (picks.model || picks.permissionMode || picks.effortLevel))
}
