/** Tests for sessionTree.js tree building and sorting. */

import { describe, expect, it } from 'vitest'
import { buildSessionTree } from './sessionTree'

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
