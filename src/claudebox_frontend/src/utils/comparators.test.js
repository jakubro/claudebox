/** Tests for comparators - React.memo comparator factories. */

import { describe, expect, it } from 'vitest'
import { createPropsComparator, sameIdSet } from './comparators'

describe('createPropsComparator', () => {
  it('returns true when every prop is shallow-equal', () => {
    const compare = createPropsComparator()
    expect(compare({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true)
  })

  it('returns false when a shared prop differs', () => {
    const compare = createPropsComparator()
    expect(compare({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('returns false when next has an extra key', () => {
    const compare = createPropsComparator()
    expect(compare({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('returns false when prev has an extra key', () => {
    const compare = createPropsComparator()
    expect(compare({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  })

  it('delegates to a special comparator for the configured key', () => {
    const compare = createPropsComparator({
      items: (prevItems, nextItems) => prevItems.length === nextItems.length,
    })
    expect(compare({ items: [1, 2] }, { items: [3, 4] })).toBe(true)
  })

  it('a false special comparator result short-circuits to unequal', () => {
    const compare = createPropsComparator({ items: () => false })
    expect(compare({ items: [1] }, { items: [1] })).toBe(false)
  })
})

describe('sameIdSet', () => {
  it('returns true for the same reference', () => {
    const set = new Set(['a'])
    expect(sameIdSet(set, set)).toBe(true)
  })

  it('returns true for two null values', () => {
    expect(sameIdSet(null, null)).toBe(true)
  })

  it('returns false when only one side is null', () => {
    expect(sameIdSet(null, new Set(['a']))).toBe(false)
  })

  it('returns true for equal contents regardless of insertion order', () => {
    expect(sameIdSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
  })

  it('returns false when sizes differ', () => {
    expect(sameIdSet(new Set(['a']), new Set(['a', 'b']))).toBe(false)
  })

  it('returns false when same size but different members', () => {
    expect(sameIdSet(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false)
  })

  it('returns true for two distinct empty sets', () => {
    expect(sameIdSet(new Set(), new Set())).toBe(true)
  })
})
