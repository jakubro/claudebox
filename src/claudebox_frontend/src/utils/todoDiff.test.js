/** Tests for todoDiff helpers (hasDiffItems + deriveBlockedFlag_*). */

import { describe, expect, it } from 'vitest'
import { deriveBlockedFlag_live, deriveBlockedFlag_run, hasDiffItems } from './todoDiff'

describe('hasDiffItems', () => {
  it('returns false for null / undefined', () => {
    expect(hasDiffItems(null)).toBe(false)
    expect(hasDiffItems(undefined)).toBe(false)
  })

  it('returns false when all buckets are empty', () => {
    expect(hasDiffItems({ added: [], started: [], completed: [], removed: [] })).toBe(false)
  })

  it('returns true when any single bucket has items', () => {
    expect(hasDiffItems({ added: [{}] })).toBe(true)
    expect(hasDiffItems({ started: [{}] })).toBe(true)
    expect(hasDiffItems({ completed: [{}] })).toBe(true)
    expect(hasDiffItems({ removed: [{}] })).toBe(true)
  })
})

describe('deriveBlockedFlag_run', () => {
  it.each([
    ['no blockedBy field', { content: 'X' }, [], false],
    ['empty blockedBy array', { content: 'X', blockedBy: [] }, [], false],
    [
      'blockedBy with no matching items',
      { blockedBy: ['99'] },
      [{ _taskId: '1', status: 'pending' }],
      false,
    ],
    ['blocker still pending', { blockedBy: ['1'] }, [{ _taskId: '1', status: 'pending' }], true],
    ['blocker in_progress', { blockedBy: ['1'] }, [{ _taskId: '1', status: 'in_progress' }], true],
    ['blocker completed', { blockedBy: ['1'] }, [{ _taskId: '1', status: 'completed' }], false],
    ['blocker removed', { blockedBy: ['1'] }, [{ _taskId: '1', status: 'removed' }], false],
    [
      'multiple blockers — any non-terminal triggers',
      { blockedBy: ['1', '2'] },
      [
        { _taskId: '1', status: 'completed' },
        { _taskId: '2', status: 'pending' },
      ],
      true,
    ],
    [
      'multiple blockers — all terminal',
      { blockedBy: ['1', '2'] },
      [
        { _taskId: '1', status: 'completed' },
        { _taskId: '2', status: 'removed' },
      ],
      false,
    ],
  ])('%s', (_label, item, runItems, expected) => {
    expect(deriveBlockedFlag_run(item, runItems)).toBe(expected)
  })

  it('matches _taskId by string equality (numeric blockedBy still resolves)', () => {
    const item = { blockedBy: [1] } // raw number
    const runItems = [{ _taskId: '1', status: 'pending' }] // string in item
    expect(deriveBlockedFlag_run(item, runItems)).toBe(true)
  })

  it('returns false when runItems is empty', () => {
    expect(deriveBlockedFlag_run({ blockedBy: ['1'] }, [])).toBe(false)
  })

  it('returns false when runItems is null / undefined', () => {
    expect(deriveBlockedFlag_run({ blockedBy: ['1'] }, null)).toBe(false)
    expect(deriveBlockedFlag_run({ blockedBy: ['1'] }, undefined)).toBe(false)
  })
})

describe('deriveBlockedFlag_live', () => {
  // Live path delegates to the same logic — confirm parity rather than re-tabling.
  it('delegates to deriveBlockedFlag_run semantics', () => {
    const item = { blockedBy: ['1'] }
    const partition = [{ _taskId: '1', status: 'in_progress' }]
    expect(deriveBlockedFlag_live(item, partition)).toBe(deriveBlockedFlag_run(item, partition))
  })

  it('returns false for cross-partition blockers (not in the live set)', () => {
    expect(deriveBlockedFlag_live({ blockedBy: ['99'] }, [])).toBe(false)
  })
})
