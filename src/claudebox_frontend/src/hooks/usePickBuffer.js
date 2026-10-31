/** Picker changes made before their session is on screen, kept for the session they are for. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { setEffortLevel as apiSetEffortLevel } from '../api/effortLevels'
import { setModel as apiSetModel } from '../api/models'
import { setPermissionMode as apiSetPermissionMode } from '../api/permissionModes'
import { hasSettings, PickFate, pickBufferFate, sameOwner } from '../utils/pickBuffer'
import { ownerTagFor } from '../utils/sessionOwnership'

/**
 * A pick records its owner when made (the opening session, else the next creation) and drains only into
 * it, model -> permission -> effort, into the session fixed at drain start, shown there until it settles.
 */
export default function usePickBuffer({
  workspaceId,
  routedSessionId,
  attachedSessionId,
  containerId,
  isOwnerAttached,
  creations,
  getCreation,
  refreshSession,
  onError,
}) {
  const [pending, setPending] = useState(null)
  const [applying, setApplying] = useState(null)
  const drainingRef = useRef(false)
  const pickContextRef = useRef({ routedSessionId, workspaceId })
  pickContextRef.current = { routedSessionId, workspaceId }

  const bufferPick = useCallback(
    (field, value) => {
      const { routedSessionId: routed, workspaceId: wsId } = pickContextRef.current
      const owner = ownerTagFor({ routedSessionId: routed, creations: getCreation() })

      setPending(prev => {
        const kept = prev && prev.workspaceId === wsId && sameOwner(prev.owner, owner)
        return { ...(kept ? prev : { owner, workspaceId: wsId }), [field]: value }
      })
    },
    [getCreation],
  )

  useEffect(() => {
    if (!pending || drainingRef.current) {
      return
    }

    const fate = pickBufferFate(pending, {
      workspaceId,
      routedSessionId,
      attachedSessionId,
      isOwnerAttached,
      creations,
    })

    if (fate === PickFate.DISCARD) {
      setPending(null)
    } else if (fate === PickFate.REBIND) {
      setPending({ ...pending, owner: { creation: creations.current + 1 } })
    } else if (fate === PickFate.DRAIN) {
      setPending(null)

      if (hasSettings(pending)) {
        const target = { sessionId: attachedSessionId, containerId }
        drainingRef.current = true
        setApplying({ ...pending, target })
        void applyPicks(pending, target, onError)
          .then(() => refreshSession())
          .finally(() => {
            drainingRef.current = false
            setApplying(null)
          })
      }
    }
  }, [
    pending,
    workspaceId,
    routedSessionId,
    attachedSessionId,
    containerId,
    isOwnerAttached,
    creations,
    refreshSession,
    onError,
  ])

  const applyingHere = applying?.target.sessionId === attachedSessionId ? applying : null
  const shown = pending ?? applyingHere

  return {
    bufferPick,
    pendingModel: shown?.model ?? null,
    pendingPermissionMode: shown?.permissionMode ?? null,
    pendingEffortLevel: shown?.effortLevel ?? null,
    pendingBundle: pending?.bundle ?? null,
    isApplyingPendingConfig: hasSettings(pending) || hasSettings(applyingHere),
  }
}

async function applyPicks({ model, permissionMode, effortLevel }, target, onError) {
  // Each await confirms the runtime applied one change before the next; a failure is reported and
  // the rest still apply.
  const steps = [
    [model, apiSetModel, 'Failed to apply model'],
    [permissionMode, apiSetPermissionMode, 'Failed to apply permission mode'],
    [effortLevel, apiSetEffortLevel, 'Failed to apply effort level'],
  ]

  for (const [value, apply, failure] of steps) {
    if (!value) {
      continue
    }
    try {
      await apply(value, target)
    } catch {
      onError?.(failure)
    }
  }
}
