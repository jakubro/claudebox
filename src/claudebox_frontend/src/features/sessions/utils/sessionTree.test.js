/** Tests for sessionTree.js tree building, sorting, filtering, and counting. */

import { describe, expect, it } from 'vitest'
import { SESSION_FILTERS } from '../../../config/sessionFilters'
import {
  buildSearchResults,
  buildSessionTree,
  countTreeRows,
  matchesSearchQuery,
  matchesSessionFilter,
  originIdFor,
} from './sessionTree'

const mkSession = (id, opts = {}) => ({
  session_id: id,
  num_turns: 1,
  parent_session_id: null,
  updated_at: '2025-01-01T00:00:00Z',
  started_at: '2025-01-01T00:00:00Z',
  ...opts,
})

describe('buildSessionTree', () => {
  it('returns root sessions with no children', () => {
    const sessions = [mkSession('a'), mkSession('b')]
    const { rootSessions, childrenMap } = buildSessionTree(sessions, [], null)

    expect(rootSessions).toHaveLength(2)
    expect(childrenMap.size).toBe(0)
  })

  it('groups children under parents', () => {
    const sessions = [mkSession('parent'), mkSession('child', { parent_session_id: 'parent' })]
    const { rootSessions, childrenMap } = buildSessionTree(sessions, [], null)

    expect(rootSessions).toHaveLength(1)
    expect(rootSessions[0].session_id).toBe('parent')
    expect(childrenMap.get('parent')).toHaveLength(1)
  })

  it('filters out empty sessions', () => {
    const sessions = [mkSession('active'), mkSession('empty', { num_turns: 0 })]
    const { rootSessions } = buildSessionTree(sessions, [], null)

    expect(rootSessions).toHaveLength(1)
    expect(rootSessions[0].session_id).toBe('active')
  })

  it('keeps current session even if empty', () => {
    const sessions = [mkSession('current', { num_turns: 0 })]
    const { rootSessions } = buildSessionTree(sessions, [], 'current')

    expect(rootSessions).toHaveLength(1)
  })

  it('sorts pinned sessions first', () => {
    const sessions = [
      mkSession('a', { updated_at: '2025-02-01T00:00:00Z' }),
      mkSession('b', { updated_at: '2025-01-01T00:00:00Z' }),
    ]
    const { rootSessions } = buildSessionTree(sessions, ['b'], null)

    expect(rootSessions[0].session_id).toBe('b')
  })

  it('sorts unpinned by newest descendant timestamp first', () => {
    const sessions = [
      mkSession('old', { updated_at: '2025-01-01T00:00:00Z' }),
      mkSession('new', { updated_at: '2025-02-01T00:00:00Z' }),
    ]
    const { rootSessions } = buildSessionTree(sessions, [], null)

    expect(rootSessions[0].session_id).toBe('new')
  })

  it('pinned fork appears in both root and children', () => {
    const sessions = [mkSession('parent'), mkSession('child', { parent_session_id: 'parent' })]
    const { rootSessions, childrenMap } = buildSessionTree(sessions, ['child'], null)

    expect(rootSessions).toHaveLength(2)
    expect(childrenMap.get('parent')).toHaveLength(1)
  })

  it('considers child timestamps when sorting parent', () => {
    const sessions = [
      mkSession('parent-old', { updated_at: '2025-01-01T00:00:00Z' }),
      mkSession('parent-new', { updated_at: '2025-01-02T00:00:00Z' }),
      mkSession('child', { parent_session_id: 'parent-old', updated_at: '2025-03-01T00:00:00Z' }),
    ]
    const { rootSessions } = buildSessionTree(sessions, [], null)

    // parent-old should sort first because its child has the newest timestamp
    expect(rootSessions[0].session_id).toBe('parent-old')
  })

  it('sorts container sessions before non-container sessions', () => {
    const sessions = [
      mkSession('no-ctr', { updated_at: '2025-02-01T00:00:00Z' }),
      mkSession('has-ctr', { updated_at: '2025-01-01T00:00:00Z', container_id: 'ctr-1' }),
    ]
    const { rootSessions } = buildSessionTree(sessions, [], null)

    expect(rootSessions[0].session_id).toBe('has-ctr')
    expect(rootSessions[1].session_id).toBe('no-ctr')
  })

  it('keeps pinned before container sessions', () => {
    const sessions = [
      mkSession('pinned', { updated_at: '2025-01-01T00:00:00Z' }),
      mkSession('has-ctr', { updated_at: '2025-02-01T00:00:00Z', container_id: 'ctr-1' }),
    ]
    const { rootSessions } = buildSessionTree(sessions, ['pinned'], null)

    expect(rootSessions[0].session_id).toBe('pinned')
    expect(rootSessions[1].session_id).toBe('has-ctr')
  })

  it('sorts container sessions by timestamp among themselves', () => {
    const sessions = [
      mkSession('ctr-old', { updated_at: '2025-01-01T00:00:00Z', container_id: 'ctr-1' }),
      mkSession('ctr-new', { updated_at: '2025-02-01T00:00:00Z', container_id: 'ctr-2' }),
    ]
    const { rootSessions } = buildSessionTree(sessions, [], null)

    expect(rootSessions[0].session_id).toBe('ctr-new')
    expect(rootSessions[1].session_id).toBe('ctr-old')
  })

  it('falls back to timestamp-only when no containers', () => {
    const sessions = [
      mkSession('old', { updated_at: '2025-01-01T00:00:00Z' }),
      mkSession('new', { updated_at: '2025-02-01T00:00:00Z' }),
    ]
    const { rootSessions } = buildSessionTree(sessions, [], null)

    expect(rootSessions[0].session_id).toBe('new')
    expect(rootSessions[1].session_id).toBe('old')
  })
})

describe('matchesSessionFilter', () => {
  const pinnedSet = new Set(['pinned-1'])

  it('named is a null check on session.name, not a heuristic', () => {
    expect(
      matchesSessionFilter(SESSION_FILTERS.NAMED, mkSession('a', { name: 'spike' }), pinnedSet),
    ).toBe(true)
    expect(
      matchesSessionFilter(SESSION_FILTERS.NAMED, mkSession('a', { name: null }), pinnedSet),
    ).toBe(false)
  })

  it('pinned matches only sessions in the pinned set', () => {
    expect(matchesSessionFilter(SESSION_FILTERS.PINNED, mkSession('pinned-1'), pinnedSet)).toBe(
      true,
    )
    expect(matchesSessionFilter(SESSION_FILTERS.PINNED, mkSession('other'), pinnedSet)).toBe(false)
  })

  it('threads matches is_side_thread, subsessions match a recorded spawner', () => {
    const ordinary = mkSession('a', { name: 'x' })
    const thread = mkSession('b', { is_side_thread: true })
    const spawned = mkSession('c', { spawned_from_session_id: 'a' })
    expect(matchesSessionFilter(SESSION_FILTERS.THREADS, ordinary, pinnedSet)).toBe(false)
    expect(matchesSessionFilter(SESSION_FILTERS.THREADS, thread, pinnedSet)).toBe(true)
    expect(matchesSessionFilter(SESSION_FILTERS.SUBSESSIONS, spawned, pinnedSet)).toBe(true)
    expect(matchesSessionFilter(SESSION_FILTERS.SUBSESSIONS, thread, pinnedSet)).toBe(false)
    expect(matchesSessionFilter(SESSION_FILTERS.SUBSESSIONS, ordinary, pinnedSet)).toBe(false)
  })

  it('origin id follows the filter: the spawner under subsessions, the parent under threads', () => {
    const spawnedFork = mkSession('c', {
      parent_session_id: 'forked-from',
      spawned_from_session_id: 'spawned-by',
    })
    expect(originIdFor(SESSION_FILTERS.SUBSESSIONS, spawnedFork)).toBe('spawned-by')
    expect(originIdFor(SESSION_FILTERS.THREADS, spawnedFork)).toBe('forked-from')
  })

  it('conversations matches every session except side threads', () => {
    const ordinary = mkSession('a')
    const thread = mkSession('b', { is_side_thread: true })
    expect(matchesSessionFilter(SESSION_FILTERS.CONVERSATIONS, ordinary, pinnedSet)).toBe(true)
    expect(matchesSessionFilter(SESSION_FILTERS.CONVERSATIONS, thread, pinnedSet)).toBe(false)
  })

  it('all matches every session, side threads included', () => {
    const ordinary = mkSession('a')
    const thread = mkSession('b', { is_side_thread: true })
    expect(matchesSessionFilter(SESSION_FILTERS.ALL, ordinary, pinnedSet)).toBe(true)
    expect(matchesSessionFilter(SESSION_FILTERS.ALL, thread, pinnedSet)).toBe(true)
  })
})

describe('countTreeRows', () => {
  it('counts each root once', () => {
    const tree = buildSessionTree([mkSession('a'), mkSession('b')], [], null)
    expect(countTreeRows(tree)).toBe(2)
  })

  it('counts a parent-child pair as two rows', () => {
    const sessions = [mkSession('parent'), mkSession('child', { parent_session_id: 'parent' })]
    const tree = buildSessionTree(sessions, [], null)
    expect(countTreeRows(tree)).toBe(2)
  })

  it('counts a pinned fork twice - once as root, once nested under its parent', () => {
    const sessions = [mkSession('parent'), mkSession('child', { parent_session_id: 'parent' })]
    const tree = buildSessionTree(sessions, ['child'], null)
    // Matches what SessionTree actually renders: rootSessions=[parent, child], plus child
    // rendered again under parent's own childrenMap entry.
    expect(countTreeRows(tree)).toBe(3)
  })

  it('counts zero for an empty tree', () => {
    const tree = buildSessionTree([], [], null)
    expect(countTreeRows(tree)).toBe(0)
  })
})

describe('matchesSearchQuery', () => {
  it('matches on name, case-insensitively', () => {
    expect(matchesSearchQuery(mkSession('a', { name: 'Parser Rewrite' }), 'parser')).toBe(true)
    expect(matchesSearchQuery(mkSession('a', { name: 'Parser Rewrite' }), 'PARSER')).toBe(true)
    expect(matchesSearchQuery(mkSession('a', { name: 'Parser Rewrite' }), 'compiler')).toBe(false)
  })

  it('matches on the full session id, not just its displayed prefix', () => {
    const session = mkSession('abcdef1234567890', { name: null })
    expect(matchesSearchQuery(session, 'abcdef12')).toBe(true)
    expect(matchesSearchQuery(session, '567890')).toBe(true)
  })

  it('a null name never matches, rather than coercing to the string "null"', () => {
    expect(matchesSearchQuery(mkSession('a', { name: null }), 'null')).toBe(false)
  })
})

describe('buildSearchResults', () => {
  it('spans every session regardless of pin state - search ignores the filter entirely', () => {
    const sessions = [
      mkSession('pinned', { name: 'spike' }),
      mkSession('unpinned', { name: 'spike-two' }),
    ]
    const results = buildSearchResults(sessions, 'spike', ['pinned'], null)
    expect(results.map(s => s.session_id).sort()).toEqual(['pinned', 'unpinned'])
  })

  it('is flat: a matched fork of an unmatched parent still renders, with no parent context', () => {
    const sessions = [
      mkSession('parent', { name: 'unrelated' }),
      mkSession('child', { name: 'spike', parent_session_id: 'parent' }),
    ]
    const results = buildSearchResults(sessions, 'spike', [], null)
    expect(results).toHaveLength(1)
    expect(results[0].session_id).toBe('child')
  })

  it('a pinned fork appears once, not the tree-building twice', () => {
    const sessions = [
      mkSession('parent', { name: 'spike-parent' }),
      mkSession('child', { name: 'spike-child', parent_session_id: 'parent' }),
    ]
    const results = buildSearchResults(sessions, 'spike', ['child'], null)
    expect(results).toHaveLength(2)
  })

  it('excludes empty sessions, same as the list itself', () => {
    const sessions = [mkSession('abandoned', { name: 'spike', num_turns: 0 })]
    expect(buildSearchResults(sessions, 'spike', [], null)).toHaveLength(0)
  })

  it('applies the same three-tier ordering: pinned, then with-container, then without', () => {
    const sessions = [
      mkSession('plain', { name: 'spike', updated_at: '2025-02-01T00:00:00Z' }),
      mkSession('ctr', { name: 'spike', updated_at: '2025-01-01T00:00:00Z', container_id: 'c-1' }),
      mkSession('pinned', { name: 'spike', updated_at: '2024-01-01T00:00:00Z' }),
    ]
    const results = buildSearchResults(sessions, 'spike', ['pinned'], null)
    expect(results.map(s => s.session_id)).toEqual(['pinned', 'ctr', 'plain'])
  })
})
