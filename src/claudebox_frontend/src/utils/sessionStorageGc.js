/** Garbage-collect per-session localStorage keys once their session no longer exists. */

import { listSessionsForWorkspace } from '../api/sessions'
import { listWorkspaces } from '../api/workspaces'
import {
  DRAFT_STORAGE_PREFIX,
  INLINE_REPLIES_STORAGE_PREFIX,
  INPUT_HISTORY_STORAGE_PREFIX,
  MESSAGE_QUEUE_STORAGE_PREFIX,
} from '../config/storage'

const SESSION_SCOPED_PREFIXES = [
  DRAFT_STORAGE_PREFIX,
  INPUT_HISTORY_STORAGE_PREFIX,
  INLINE_REPLIES_STORAGE_PREFIX,
  MESSAGE_QUEUE_STORAGE_PREFIX,
]

/**
 * Live session ids across every registered workspace - storage keys carry no workspace segment.
 * Null when any lookup fails: a partial set would mark that workspace's sessions dead.
 * @param {string} currentWorkspaceId
 * @param {Iterable<string>} currentLiveIds - Live ids already fetched for the current workspace.
 * @returns {Promise<Set<string> | null>}
 */
export async function collectLiveSessionIdsAcrossWorkspaces(currentWorkspaceId, currentLiveIds) {
  const ids = new Set(currentLiveIds)

  try {
    const workspaces = await listWorkspaces()
    const others = workspaces.filter(w => w.id !== currentWorkspaceId)
    const listings = await Promise.all(others.map(w => listSessionsForWorkspace(w.id)))
    for (const listing of listings) {
      for (const session of listing.sessions || []) {
        ids.add(session.session_id)
      }
    }
  } catch {
    return null
  }

  return ids
}

/**
 * Remove per-session localStorage keys whose session is not in `liveSessionIds`.
 * Keys outside the four known session-scoped prefixes are never touched.
 * @param {Iterable<string>} liveSessionIds - Session IDs currently known to exist.
 * @param {Storage} [storage] - Injectable for tests; defaults to window.localStorage.
 * @returns {string[]} The keys that were removed.
 */
export function sweepDeadSessionStorage(liveSessionIds, storage = localStorage) {
  const live = new Set(liveSessionIds)
  const keysToRemove = []

  // Collect first, then remove - mutating storage mid-iteration would skip entries.
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    const prefix = SESSION_SCOPED_PREFIXES.find(p => key.startsWith(p))

    if (prefix && !live.has(key.slice(prefix.length))) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    try {
      storage.removeItem(key)
    } catch {
      // Storage unavailable - nothing more to reclaim this pass.
    }
  }

  return keysToRemove
}
