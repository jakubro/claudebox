/** Tests for the inline-threads overlay geometry helpers: spanRect, stackFloats, rangeContainsPoint. */

import { describe, expect, it } from 'vitest'
import {
  isRangeVisible,
  positionsEqual,
  rangeContainsPoint,
  spanRect,
  stackFloats,
} from './overlayDom'

describe('spanRect', () => {
  it('returns the last client rect (the end of the span)', () => {
    const range = {
      getClientRects: () => [
        { left: 0, top: 0, right: 50, bottom: 12 },
        { left: 0, top: 12, right: 30, bottom: 24 },
      ],
    }

    expect(spanRect(range)).toMatchObject({ left: 0, top: 12, right: 30, bottom: 24 })
  })

  it('returns null when the range paints nothing (collapsed source)', () => {
    expect(spanRect({ getClientRects: () => [] })).toBeNull()
  })
})

describe('stackFloats', () => {
  it('leaves boxes in independent horizontal bands at their desired positions', () => {
    const out = stackFloats([
      { id: 'a', left: 0, top: 0, width: 100, height: 40 },
      { id: 'b', left: 200, top: 10, width: 100, height: 40 },
    ])

    expect(out.get('a')).toEqual({ left: 0, top: 0 })
    expect(out.get('b')).toEqual({ left: 200, top: 10 })
  })

  it('pushes a horizontally-overlapping box below the previous one', () => {
    const out = stackFloats(
      [
        { id: 'a', left: 0, top: 0, width: 100, height: 40 },
        { id: 'b', left: 20, top: 10, width: 100, height: 40 },
      ],
      8,
    )

    expect(out.get('a')).toEqual({ left: 0, top: 0 })
    expect(out.get('b')).toEqual({ left: 20, top: 48 })
  })
})

describe('rangeContainsPoint', () => {
  it('is true inside a client rect and false outside', () => {
    const range = { getClientRects: () => [{ left: 10, top: 10, right: 50, bottom: 30 }] }

    expect(rangeContainsPoint(range, 20, 20)).toBe(true)
    expect(rangeContainsPoint(range, 60, 20)).toBe(false)
  })
})

describe('positionsEqual', () => {
  it('is true for equal maps and false when a position differs or a key is missing', () => {
    const a = new Map([['x', { left: 1, top: 2 }]])

    expect(positionsEqual(a, new Map([['x', { left: 1, top: 2 }]]))).toBe(true)
    expect(positionsEqual(a, new Map([['x', { left: 1, top: 9 }]]))).toBe(false)
    expect(positionsEqual(a, new Map())).toBe(false)
  })
})

describe('isRangeVisible', () => {
  it('reflects the visibility of the range start element', () => {
    const p = document.createElement('p')
    p.textContent = 'hello world'
    document.body.appendChild(p)
    const range = document.createRange()
    range.selectNodeContents(p.firstChild)

    expect(isRangeVisible(range)).toBe(true)

    p.style.visibility = 'hidden'
    expect(isRangeVisible(range)).toBe(false)

    document.body.innerHTML = ''
  })
})
