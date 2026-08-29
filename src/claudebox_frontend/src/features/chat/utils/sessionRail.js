/** Pure session rail derivation: ancestry walk, depth cap, walked-back tail storage. */

import { CHAT_RAIL_MAX_DEPTH } from '../../../config/dimensions'

/** sessionStorage key for one root's walked-back tail - per browser tab by construction. */
export function railTailStorageKey(rootSessionId) {
  return `chat-rail-tail:${rootSessionId}`
}

/** Read a persisted visited-path array; `[]` on anything missing, malformed, or unreadable. */
export function readStoredPath(key) {
  try {
    const raw = sessionStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Persist a visited-path array. Failures are swallowed - sessionStorage may be unavailable, and
 * the tail is a convenience, not a correctness requirement.
 */
export function writeStoredPath(key, path) {
  try {
    sessionStorage.setItem(key, JSON.stringify(path))
  } catch {
    // See docstring - intentionally silent.
  }
}

/**
 * Walk `parent_session_id` from `focusedId` to the root over the full fetched session list, never
 * `buildSessionTree`, whose presentation filter would punch a hole mid-chain. Root-first.
 *
 * Only a drill-down hop (`is_side_thread`) pushes a group; a fork hop pushes nothing but the walk
 * climbs past it. A session absent from `sessions` ends the walk at that id.
 */
export function deriveAncestorChain(sessions, focusedId) {
  if (!focusedId) {
    return []
  }

  const sessionMap = new Map(sessions.map(s => [s.session_id, s]))
  const chain = [focusedId]
  let current = sessionMap.get(focusedId)

  while (current?.parent_session_id) {
    if (current.is_side_thread) {
      chain.unshift(current.parent_session_id)
    }
    current = sessionMap.get(current.parent_session_id)
  }

  return chain
}

/**
 * Cap the rendered ancestor count to `CHAT_RAIL_MAX_DEPTH - 1`, keeping the root and the nearest
 * ancestors; the dropped middle stays reachable from the header path, which renders the full chain.
 */
export function capAncestors(chain) {
  const ancestors = chain.slice(0, -1)
  const maxAncestors = CHAT_RAIL_MAX_DEPTH - 1

  if (ancestors.length <= maxAncestors) {
    return ancestors
  }

  if (maxAncestors <= 1) {
    return ancestors.slice(0, maxAncestors)
  }

  return [ancestors[0], ...ancestors.slice(-(maxAncestors - 1))]
}

/**
 * Derive the walked-back tail for this focus from the root's persisted `visitedPath`: a known
 * focus keeps it, drilling truncates at the parent, anything else resets to `chain`.
 */
export function deriveVisitedPath(chain, storedPath) {
  const focusedId = chain[chain.length - 1]
  const stored = Array.isArray(storedPath) ? storedPath : []

  let visitedPath
  if (stored.includes(focusedId)) {
    visitedPath = stored
  } else {
    const parentId = chain.length > 1 ? chain[chain.length - 2] : null
    const parentIndex = parentId ? stored.indexOf(parentId) : -1
    visitedPath = parentIndex >= 0 ? [...stored.slice(0, parentIndex + 1), focusedId] : chain
  }

  const focusedIndex = visitedPath.indexOf(focusedId)
  const tail = visitedPath.slice(focusedIndex + 1)

  return { visitedPath, tail }
}
