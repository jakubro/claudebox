/** Tests for dropIndex helper - visual-slot to flat-list index translation. */

import { describe, expect, it } from 'vitest'
import { computeFlatDropIndex, isSelfDrop } from './dropIndex'

describe('computeFlatDropIndex', () => {
  it('returns null when over-ticket is not in the column', () => {
    const col = [{ path: 'a', swimlane: 'frontend' }]
    expect(computeFlatDropIndex(col, 'frontend', 'missing')).toBeNull()
  })

  it('single-swimlane cell - flat index equals visual slot', () => {
    const col = [
      { path: 'a', swimlane: 'frontend' },
      { path: 'b', swimlane: 'frontend' },
      { path: 'c', swimlane: 'frontend' },
    ]
    expect(computeFlatDropIndex(col, 'frontend', 'a')).toBe(0)
    expect(computeFlatDropIndex(col, 'frontend', 'b')).toBe(1)
    expect(computeFlatDropIndex(col, 'frontend', 'c')).toBe(2)
  })

  it('mixed swimlanes - walks past out-of-lane entries', () => {
    const col = [
      { path: 'fe1', swimlane: 'frontend' },
      { path: 'be1', swimlane: 'backend' },
      { path: 'fe2', swimlane: 'frontend' },
      { path: 'be2', swimlane: 'backend' },
      { path: 'fe3', swimlane: 'frontend' },
    ]
    // dropping onto fe2 (visual slot 1 in frontend lane) -> flat index 2 (its absolute position)
    expect(computeFlatDropIndex(col, 'frontend', 'fe2')).toBe(2)
    // dropping onto be2 (visual slot 1 in backend lane) -> flat index 3
    expect(computeFlatDropIndex(col, 'backend', 'be2')).toBe(3)
    // dropping onto fe3 (visual slot 2 in frontend lane) -> flat index 4
    expect(computeFlatDropIndex(col, 'frontend', 'fe3')).toBe(4)
  })

  it('drop on first ticket of cell -> first lane match position', () => {
    const col = [
      { path: 'be1', swimlane: 'backend' },
      { path: 'fe1', swimlane: 'frontend' },
      { path: 'fe2', swimlane: 'frontend' },
    ]
    expect(computeFlatDropIndex(col, 'frontend', 'fe1')).toBe(1)
  })

  it('__unsorted__ swimlane: ticket without swimlane treated as unsorted', () => {
    const col = [
      { path: 'a' }, // no swimlane
      { path: 'fe', swimlane: 'frontend' },
      { path: 'b' }, // no swimlane
    ]
    expect(computeFlatDropIndex(col, '__unsorted__', 'a')).toBe(0)
    expect(computeFlatDropIndex(col, '__unsorted__', 'b')).toBe(2)
  })

  it('over-ticket lane mismatch -> returns null', () => {
    // Asking for a flat index against the wrong lane (the over-ticket isn't
    // in that lane's filtered view). findIndex returns -1 -> null.
    const col = [{ path: 'fe', swimlane: 'frontend' }]
    expect(computeFlatDropIndex(col, 'backend', 'fe')).toBeNull()
  })

  it('handles single-element cell', () => {
    const col = [{ path: 'only', swimlane: 'frontend' }]
    expect(computeFlatDropIndex(col, 'frontend', 'only')).toBe(0)
  })
})

describe('isSelfDrop', () => {
  it('true when source === over', () => {
    expect(isSelfDrop('a', 'a')).toBe(true)
  })

  it('false when source !== over', () => {
    expect(isSelfDrop('a', 'b')).toBe(false)
  })
})
