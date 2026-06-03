/** Tests for comparators. */

import { describe, expect, it } from 'vitest'
import { createPropsComparator } from './comparators'

describe('createPropsComparator', () => {
  describe('default shallow compare', () => {
    const compare = createPropsComparator()

    it('returns true for identical props', () => {
      const obj = { a: 1, b: 'hello' }
      expect(compare(obj, obj)).toBe(true)
    })

    it('returns true when all values are strictly equal', () => {
      expect(compare({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true)
    })

    it('returns false when a primitive value differs', () => {
      expect(compare({ a: 1 }, { a: 2 })).toBe(false)
    })

    it('returns false for different object references even if deeply equal', () => {
      const arr1 = [1, 2, 3]
      const arr2 = [1, 2, 3]
      expect(compare({ items: arr1 }, { items: arr2 })).toBe(false)
    })

    it('returns true when both objects are empty', () => {
      expect(compare({}, {})).toBe(true)
    })

    it('returns true for same reference values', () => {
      const sharedArr = [1, 2]
      expect(compare({ items: sharedArr }, { items: sharedArr })).toBe(true)
    })
  })

  describe('custom per-field comparators', () => {
    it('uses custom comparator for specified field', () => {
      const compare = createPropsComparator({
        items: (a, b) => a.length === b.length,
      })

      expect(compare({ items: [1, 2] }, { items: [3, 4] })).toBe(true)
      expect(compare({ items: [1] }, { items: [1, 2] })).toBe(false)
    })

    it('still uses shallow compare for fields without custom comparator', () => {
      const compare = createPropsComparator({
        items: (a, b) => a.length === b.length,
      })

      expect(compare({ items: [1], label: 'a' }, { items: [2], label: 'a' })).toBe(true)

      expect(compare({ items: [1], label: 'a' }, { items: [2], label: 'b' })).toBe(false)
    })

    it('supports multiple custom comparators', () => {
      const compare = createPropsComparator({
        items: (a, b) => a.length === b.length,
        events: (a, b) => a.length === b.length,
      })

      expect(compare({ items: [1, 2], events: ['a'] }, { items: [3, 4], events: ['b'] })).toBe(true)

      expect(compare({ items: [1, 2], events: ['a'] }, { items: [3, 4], events: ['b', 'c'] })).toBe(
        false,
      )
    })
  })

  describe('key-set union', () => {
    it('returns false when prev has a key that next lacks', () => {
      const compare = createPropsComparator()
      expect(compare({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    })

    it('returns false when next has a key that prev lacks', () => {
      const compare = createPropsComparator()
      expect(compare({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    })

    it('handles mismatched keys with custom comparator on missing field', () => {
      const compare = createPropsComparator({
        extra: (a, b) => a === b,
      })

      // prev has extra=undefined, next has extra=undefined => comparator called with (undefined, undefined)
      expect(compare({ a: 1 }, { a: 1 })).toBe(true)
    })

    it('uses custom comparator when key exists only in one side', () => {
      const compare = createPropsComparator({
        b: (a, b) => a == null && b == null,
      })

      // b is undefined on both sides — the key is only in neither object's own keys
      // but if one side has it, the union picks it up
      expect(compare({ a: 1, b: 5 }, { a: 1 })).toBe(false)
    })
  })
})
