/** Tests for todoDiff - blocked-flag derivation, run-item merging, and status bucketing. */

import { describe, expect, it } from 'vitest'
import {
  bucketize,
  deriveBlockedFlag_live,
  deriveBlockedFlag_run,
  hasDiffItems,
  mergeRunItems,
} from './todoDiff'

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
      'multiple blockers - any non-terminal triggers',
      { blockedBy: ['1', '2'] },
      [
        { _taskId: '1', status: 'completed' },
        { _taskId: '2', status: 'pending' },
      ],
      true,
    ],
    [
      'multiple blockers - all terminal',
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

  it('skips run items without a _taskId when indexing candidates', () => {
    const item = { blockedBy: ['1'] }
    const runItems = [{ status: 'pending' }, { _taskId: '1', status: 'pending' }]
    expect(deriveBlockedFlag_run(item, runItems)).toBe(true)
  })
})

describe('deriveBlockedFlag_live', () => {
  // Live path delegates to the same logic - confirm parity rather than re-tabling.
  it('delegates to deriveBlockedFlag_run semantics', () => {
    const item = { blockedBy: ['1'] }
    const partition = [{ _taskId: '1', status: 'in_progress' }]
    expect(deriveBlockedFlag_live(item, partition)).toBe(deriveBlockedFlag_run(item, partition))
  })

  it('returns false for cross-partition blockers (not in the live set)', () => {
    expect(deriveBlockedFlag_live({ blockedBy: ['99'] }, [])).toBe(false)
  })
})

describe('mergeRunItems', () => {
  it('returns an empty list without todoDiffs or task blocks', () => {
    expect(mergeRunItems([], new Map())).toEqual([])
    expect(mergeRunItems([{ toolUseId: 't1' }], null)).toEqual([])
    expect(mergeRunItems(null, new Map())).toEqual([])
  })

  it('skips task blocks with no matching diff entry', () => {
    const todoDiffs = new Map()
    expect(mergeRunItems([{ toolUseId: 'missing' }], todoDiffs)).toEqual([])
  })

  it('classifies items by bucket when the item carries no explicit status', () => {
    const todoDiffs = new Map([
      [
        't1',
        { completed: [{ _taskId: '1', content: 'A' }], added: [{ _taskId: '2', content: 'B' }] },
      ],
    ])
    const merged = mergeRunItems([{ toolUseId: 't1' }], todoDiffs)

    expect(merged).toEqual([
      { _taskId: '1', content: 'A', status: 'completed' },
      { _taskId: '2', content: 'B', status: 'pending' },
    ])
  })

  it('lets an explicit item.status override the bucket-derived status', () => {
    const todoDiffs = new Map([
      ['t1', { started: [{ _taskId: '1', content: 'A', status: 'completed' }] }],
    ])
    const merged = mergeRunItems([{ toolUseId: 't1' }], todoDiffs)

    expect(merged[0].status).toBe('completed')
  })

  it('later blocks update an earlier item in place while preserving first-seen order', () => {
    const todoDiffs = new Map([
      [
        't1',
        {
          added: [
            { _taskId: '1', content: 'A' },
            { _taskId: '2', content: 'B' },
          ],
        },
      ],
      ['t2', { completed: [{ _taskId: '1', content: 'A' }] }],
    ])
    const merged = mergeRunItems([{ toolUseId: 't1' }, { toolUseId: 't2' }], todoDiffs)

    expect(merged.map(i => i._taskId)).toEqual(['1', '2'])
    expect(merged[0].status).toBe('completed')
  })

  it('falls back to content-based keys for items without a _taskId', () => {
    const todoDiffs = new Map([['t1', { added: [{ content: 'no id here' }] }]])
    const merged = mergeRunItems([{ toolUseId: 't1' }], todoDiffs)

    expect(merged).toEqual([{ content: 'no id here', status: 'pending' }])
  })
})

describe('bucketize', () => {
  it('counts each item under its own status bucket', () => {
    const items = [
      { _taskId: '1', status: 'completed' },
      { _taskId: '2', status: 'in_progress' },
      { _taskId: '3', status: 'pending' },
      { _taskId: '4', status: 'removed' },
    ]

    const { counts } = bucketize(items)

    expect(counts).toEqual({ completed: 1, in_progress: 1, blocked: 0, pending: 1, removed: 1 })
  })

  it('counts a blocked item toward blocked instead of its status bucket', () => {
    const items = [
      { _taskId: '1', status: 'pending', blockedBy: ['2'] },
      { _taskId: '2', status: 'in_progress' },
    ]

    const { counts, rowGroups } = bucketize(items)

    expect(counts.blocked).toBe(1)
    expect(counts.pending).toBe(0)
    // Still rendered in its actual-status row group, just flagged blocked for styling.
    expect(rowGroups.some(i => i._taskId === '1')).toBe(true)
  })

  it('falls back to the pending row bucket for an unrecognized status', () => {
    const items = [{ _taskId: '1', status: 'unknown-status' }]

    const { rowGroups } = bucketize(items)

    expect(rowGroups).toEqual(items)
  })

  it('orders row groups by the fixed bucket order regardless of input order', () => {
    const items = [
      { _taskId: '1', status: 'removed' },
      { _taskId: '2', status: 'completed' },
      { _taskId: '3', status: 'pending' },
      { _taskId: '4', status: 'in_progress' },
    ]

    const { rowGroups } = bucketize(items)

    expect(rowGroups.map(i => i.status)).toEqual(['completed', 'in_progress', 'pending', 'removed'])
  })
})
