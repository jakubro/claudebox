/** Turn-list fold boundary: where a promoted thread's inherited history ends. */

import { EventSubtype, EventType } from '../../../config/schema'

/**
 * Whether `event` is the fork divider a side thread's first boot injects, carrying the source
 * session id. Checks `type` too - redundant over `settingChanges`, required over a raw event list.
 */
export function isForkDivider(event) {
  return (
    event.type === EventType.SYSTEM &&
    event.subtype === EventSubtype.CONTAINER_RESTARTED &&
    Boolean(event.message_data?.fork_parent_session_id)
  )
}

/**
 * Index of the last turn inherited from a promoted thread's source, or -1 when nothing folds. Only
 * meaningful for a session carrying `isSideThread`.
 *
 * The boundary is the turn whose `settingChanges` holds the fork divider. Takes the LAST match: an
 * already-forked source contributes its own divider too, and the last one is always this thread's.
 */
export function computeFoldBoundary(turns, isSideThread) {
  if (!isSideThread) {
    return -1
  }

  let boundary = -1

  for (let i = 0; i < turns.length; i++) {
    if (findForkDivider(turns[i])) {
      boundary = i
    }
  }

  return boundary
}

/** The session `turns[boundary]`'s fork divider names, or null when there is no fold. */
export function resolveForkParentId(turns, boundary) {
  if (boundary < 0) {
    return null
  }
  return findForkDivider(turns[boundary])?.message_data.fork_parent_session_id ?? null
}

function findForkDivider(turn) {
  return (turn.settingChanges || []).find(isForkDivider)
}
