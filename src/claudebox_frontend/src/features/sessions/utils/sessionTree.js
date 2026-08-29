/** Session tree building, filtering, and per-filter row counting. */

import { Bot, List, MessageSquare, MessageSquareQuote, Pin, Tag } from 'lucide-react'
import { SESSION_FILTERS } from '../../../config/sessionFilters'

export { SESSION_FILTERS }

export const SESSION_FILTER_ORDER = [
  SESSION_FILTERS.CONVERSATIONS,
  SESSION_FILTERS.NAMED,
  SESSION_FILTERS.PINNED,
  SESSION_FILTERS.THREADS,
  SESSION_FILTERS.SUBSESSIONS,
  SESSION_FILTERS.ALL,
]

export const SESSION_FILTER_LABELS = Object.freeze({
  [SESSION_FILTERS.CONVERSATIONS]: 'Conversations',
  [SESSION_FILTERS.NAMED]: 'Named',
  [SESSION_FILTERS.PINNED]: 'Pinned',
  [SESSION_FILTERS.THREADS]: 'Threads',
  [SESSION_FILTERS.SUBSESSIONS]: 'Subsessions',
  [SESSION_FILTERS.ALL]: 'All',
})

/** One glyph per filter for the panel's button row - Pinned reuses the pin action's icon. */
export const SESSION_FILTER_ICONS = Object.freeze({
  [SESSION_FILTERS.CONVERSATIONS]: MessageSquare,
  [SESSION_FILTERS.NAMED]: Tag,
  [SESSION_FILTERS.PINNED]: Pin,
  [SESSION_FILTERS.THREADS]: MessageSquareQuote,
  [SESSION_FILTERS.SUBSESSIONS]: Bot,
  [SESSION_FILTERS.ALL]: List,
})

/** Filters that show origin (what a session came from) instead of parent/child nesting. */
export const ORIGIN_FILTERS = new Set([SESSION_FILTERS.THREADS, SESSION_FILTERS.SUBSESSIONS])

/** True if `session` belongs under `filter`; applied to the flat list before the tree is built. */
export function matchesSessionFilter(filter, session, pinnedSet) {
  switch (filter) {
    case SESSION_FILTERS.CONVERSATIONS:
      return !session.is_side_thread
    case SESSION_FILTERS.NAMED:
      return session.name != null
    case SESSION_FILTERS.PINNED:
      return pinnedSet.has(session.session_id)
    case SESSION_FILTERS.THREADS:
      return Boolean(session.is_side_thread)
    case SESSION_FILTERS.SUBSESSIONS:
      return session.spawned_from_session_id != null
    default:
      return true
  }
}

/** The session an origin-filter row came from: its spawner under Subsessions, else its parent. */
export function originIdFor(filter, session) {
  return filter === SESSION_FILTERS.SUBSESSIONS
    ? session.spawned_from_session_id
    : session.parent_session_id
}

/**
 * Count of rows a {rootSessions, childrenMap} tree renders - roots plus everything reachable
 * through childrenMap, once per position. A pinned fork renders twice, so it counts twice.
 */
export function countTreeRows({ rootSessions, childrenMap }) {
  let count = 0

  const countSubtree = session => {
    count += 1
    for (const child of childrenMap.get(session.session_id) || []) {
      countSubtree(child)
    }
  }

  for (const root of rootSessions) {
    countSubtree(root)
  }

  return count
}

/** True if sessionId appears anywhere in a {rootSessions, childrenMap} tree. */
export function isSessionInTree({ rootSessions, childrenMap }, sessionId) {
  const stack = [...rootSessions]
  while (stack.length > 0) {
    const session = stack.pop()
    if (session.session_id === sessionId) {
      return true
    }
    stack.push(...(childrenMap.get(session.session_id) || []))
  }
  return false
}

/** True if a session is worth listing - has turns, a live container, or is the active one. */
function isVisibleSession(session, currentSessionId) {
  return (
    session.num_turns > 0 ||
    Boolean(session.container_id) ||
    session.session_id === currentSessionId
  )
}

/**
 * Three-tier ordering shared by the tree and by search results: pinned first, then unpinned with a
 * live container, then unpinned without one - each tier by `getTimestamp` descending.
 */
function sortByPinnedThenRecency(list, pinnedSet, getTimestamp) {
  const byTimestamp = (a, b) => {
    const ta = getTimestamp(a)
    const tb = getTimestamp(b)
    return ta > tb ? -1 : ta < tb ? 1 : 0
  }
  const pinned = list.filter(s => pinnedSet.has(s.session_id))
  const unpinned = list.filter(s => !pinnedSet.has(s.session_id))
  const withContainer = unpinned.filter(s => s.container_id).sort(byTimestamp)
  const withoutContainer = unpinned.filter(s => !s.container_id).sort(byTimestamp)
  return [...pinned, ...withContainer, ...withoutContainer]
}

/** Filters empty sessions, groups by parent_session_id, and sorts pinned first, then by max descendant timestamp. */
export function buildSessionTree(sessions, pinnedSessions, currentSessionId) {
  const pinnedSet = new Set(pinnedSessions)
  const childrenMap = new Map()
  const rootSessions = []

  const visible = sessions.filter(s => isVisibleSession(s, currentSessionId))

  // First pass: group children under parents (pinned forks appear in both places)
  for (const session of visible) {
    if (session.parent_session_id) {
      const children = childrenMap.get(session.parent_session_id) || []
      children.push(session)
      childrenMap.set(session.parent_session_id, children)
    }
    if (!session.parent_session_id || pinnedSet.has(session.session_id)) {
      rootSessions.push(session)
    }
  }

  // Fork activity bubbles up: a parent's own sort position reflects its most recently active child.
  const getMaxTimestamp = session => {
    const own = session.updated_at || session.started_at || ''
    const children = childrenMap.get(session.session_id) || []
    return children.reduce((max, child) => {
      const childMax = getMaxTimestamp(child)
      return childMax > max ? childMax : max
    }, own)
  }

  return {
    rootSessions: sortByPinnedThenRecency(rootSessions, pinnedSet, getMaxTimestamp),
    childrenMap,
  }
}

/** True if name or id contains `query`, case-insensitively; a null name never matches. */
export function matchesSearchQuery(session, query) {
  const q = query.toLowerCase()
  return Boolean(
    session.name?.toLowerCase().includes(q) || session.session_id.toLowerCase().includes(q),
  )
}

/**
 * Flat, ordered search results across every session, whatever the active filter - bypassing
 * `buildSessionTree`, so a matched fork of an unmatched parent renders, once only.
 */
export function buildSearchResults(sessions, query, pinnedSessions, currentSessionId) {
  const pinnedSet = new Set(pinnedSessions)
  const matched = sessions.filter(
    s => isVisibleSession(s, currentSessionId) && matchesSearchQuery(s, query),
  )
  return sortByPinnedThenRecency(matched, pinnedSet, s => s.updated_at || s.started_at || '')
}
