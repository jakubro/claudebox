/** Tests for inputHistoryCap - entry and byte-size eviction. */

import { describe, expect, it } from 'vitest'
import { capHistory } from './inputHistoryCap'

describe('capHistory - entry count', () => {
  it('leaves history untouched when under the entry cap', () => {
    const history = ['a', 'b', 'c']
    expect(capHistory(history, { maxEntries: 5, maxBytes: 1000 })).toEqual(['a', 'b', 'c'])
  })

  it('drops the oldest entries past the entry cap, keeping the newest', () => {
    const history = ['a', 'b', 'c', 'd', 'e']
    expect(capHistory(history, { maxEntries: 3, maxBytes: 1000 })).toEqual(['c', 'd', 'e'])
  })
})

describe('capHistory - byte size', () => {
  it('leaves history untouched when under the byte cap', () => {
    const history = ['short', 'entries']
    // Each char is ~2 bytes; well under a generous cap.
    expect(capHistory(history, { maxEntries: 100, maxBytes: 1000 })).toEqual(history)
  })

  it('drops the oldest entries past the byte cap, keeping the newest', () => {
    const history = ['x'.repeat(10), 'y'.repeat(10), 'z'.repeat(10)]
    // Cap fits only the last two entries (20 chars * 2 bytes = 40).
    expect(capHistory(history, { maxEntries: 100, maxBytes: 40 })).toEqual([
      'y'.repeat(10),
      'z'.repeat(10),
    ])
  })

  it('never drops the last remaining entry, even if it alone exceeds the byte cap', () => {
    const history = ['a'.repeat(100)]
    expect(capHistory(history, { maxEntries: 100, maxBytes: 10 })).toEqual(['a'.repeat(100)])
  })

  it('a lone oversized entry does not make a non-empty history look empty', () => {
    const history = ['small', 'a'.repeat(1000)]
    const result = capHistory(history, { maxEntries: 100, maxBytes: 10 })
    expect(result).toEqual(['a'.repeat(1000)])
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('capHistory - both caps combined', () => {
  it('applies the entry cap first, then the byte cap on the remainder', () => {
    const history = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50), 'd'.repeat(5)]
    // Entry cap keeps the last 3; byte cap (120 bytes = 60 chars) then drops one more.
    expect(capHistory(history, { maxEntries: 3, maxBytes: 120 })).toEqual([
      'c'.repeat(50),
      'd'.repeat(5),
    ])
  })
})
