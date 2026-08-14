/** Tests for the inline-threads overlay geometry helpers: spanRect, stackFloats, rangeContainsPoint. */

import { describe, expect, it } from 'vitest'
import {
  clampHorizontal,
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

describe('clampHorizontal', () => {
  const bounds = { left: 0, right: 400 }

  it('pulls in a box overflowing the right edge by exactly the overflow plus padding', () => {
    expect(clampHorizontal({ left: 350, width: 100 }, bounds)).toBe(296) // right 450 = 54px past bounds.right+pad
  })

  it('pulls in a box overflowing the left edge by exactly the overflow plus padding', () => {
    expect(clampHorizontal({ left: -20, width: 100 }, bounds)).toBe(4) // 20px past bounds.left, +4px pad
  })

  it('returns a fitting box unchanged', () => {
    expect(clampHorizontal({ left: 150, width: 100 }, bounds)).toBe(150)
  })

  it('pins a box wider than the bounds to the left edge rather than going negative', () => {
    expect(clampHorizontal({ left: 50, width: 500 }, bounds)).toBe(4)
  })
})

describe('clampHorizontal composes with stackFloats', () => {
  it('two boxes clamped into the same horizontal band still stack vertically', () => {
    const bounds = { left: 0, right: 400 }
    const boxes = [
      {
        id: 'a',
        top: 0,
        width: 100,
        height: 40,
        left: clampHorizontal({ left: 350, width: 100 }, bounds),
      },
      {
        id: 'b',
        top: 10,
        width: 100,
        height: 40,
        left: clampHorizontal({ left: 360, width: 100 }, bounds),
      },
    ]

    const out = stackFloats(boxes, 8)

    expect(out.get('a')).toEqual({ left: 296, top: 0 })
    expect(out.get('b')).toEqual({ left: 296, top: 48 })
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
