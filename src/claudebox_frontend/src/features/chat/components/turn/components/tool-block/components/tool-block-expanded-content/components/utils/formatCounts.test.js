/** Tests for formatCounts - the Todos chrome summary string. */

import { describe, expect, it } from 'vitest'
import { formatCounts } from './formatCounts'

const ICONS = {
  completed: '●',
  in_progress: '◐',
  blocked: '⊘',
  pending: '○',
  removed: '✕',
}

describe('formatCounts', () => {
  it('lists only non-zero buckets, in canonical header order', () => {
    const counts = { pending: 2, completed: 1, removed: 0, in_progress: 3 }

    expect(formatCounts(counts, ICONS)).toBe('● 1 ◐ 3 ○ 2')
  })

  it('separates a pair with a narrower gap than the gap between pairs', () => {
    const counts = { completed: 2, in_progress: 1 }

    expect(formatCounts(counts, ICONS)).toBe('● 2 ◐ 1')
  })

  it('an empty count map yields an empty string', () => {
    expect(formatCounts({}, ICONS)).toBe('')
  })

  it('a single non-zero bucket yields one pair, no group gap', () => {
    expect(formatCounts({ blocked: 4 }, ICONS)).toBe('⊘ 4')
  })
})
