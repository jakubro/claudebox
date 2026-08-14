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
 * Live session ids for the current workspace plus every other registered workspace's.
 * Storage keys carry no workspace segment, so a session alive elsewhere must count as live
 * here too or it looks dead and gets swept. Best-effort: a workspace whose sessions fetch
 * fails contributes nothing; a failed workspace-list fetch falls back to just currentLiveIds.
 * @param {string} currentWorkspaceId
 * @param {Iterable<string>} currentLiveIds - Live ids already fetched for the current workspace.
 * @returns {Promise<Set<string>>}
 */
export async function collectLiveSessionIdsAcrossWorkspaces(currentWorkspaceId, currentLiveIds) {
  const ids = new Set(currentLiveIds)
  let workspaces

  try {
    workspaces = await listWorkspaces()
  } catch {
    return ids
  }

  const others = workspaces.filter(w => w.id !== currentWorkspaceId)
  const results = await Promise.allSettled(others.map(w => listSessionsForWorkspace(w.id)))

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const session of result.value.sessions || []) {
        ids.add(session.session_id)
      }
    }
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
