/** Tests for textareaPosition utility - pure line/whitespace offset primitives. */

import { describe, expect, it } from 'vitest'
import { leadingWhitespaceLen, lineEndOffset, lineStartOffset } from './textareaPosition'

describe('lineStartOffset', () => {
  it('returns 0 for a position on the first line', () => {
    expect(lineStartOffset('hello world', 5)).toBe(0)
  })

  it('returns the index after the preceding newline', () => {
    expect(lineStartOffset('foo\nbar', 5)).toBe(4)
  })

  it('returns the position itself when it is right after a newline', () => {
    expect(lineStartOffset('foo\nbar', 4)).toBe(4)
  })

  it('finds the nearest preceding newline across multiple lines', () => {
    expect(lineStartOffset('a\nb\nc', 4)).toBe(4)
  })

  it('returns 0 at position 0', () => {
    expect(lineStartOffset('hello', 0)).toBe(0)
  })
})

describe('lineEndOffset', () => {
  it('returns value.length when there is no following newline', () => {
    expect(lineEndOffset('hello world', 5)).toBe(11)
  })

  it('returns the index of the next newline', () => {
    expect(lineEndOffset('foo\nbar', 1)).toBe(3)
  })

  it('returns pos itself when pos is already a newline', () => {
    expect(lineEndOffset('foo\nbar', 3)).toBe(3)
  })

  it('returns value.length for an empty string', () => {
    expect(lineEndOffset('', 0)).toBe(0)
  })
})

describe('leadingWhitespaceLen', () => {
  it('counts leading spaces', () => {
    expect(leadingWhitespaceLen('   hello', 0)).toBe(3)
  })

  it('counts leading tabs', () => {
    expect(leadingWhitespaceLen('\t\thello', 0)).toBe(2)
  })

  it('counts mixed leading spaces and tabs', () => {
    expect(leadingWhitespaceLen(' \t hello', 0)).toBe(3)
  })

  it('returns 0 with no leading whitespace', () => {
    expect(leadingWhitespaceLen('hello', 0)).toBe(0)
  })

  it('stops at non-whitespace content', () => {
    expect(leadingWhitespaceLen('  a  b', 0)).toBe(2)
  })

  it('measures from an offset into a multi-line value', () => {
    expect(leadingWhitespaceLen('a\n  b', 2)).toBe(2)
  })

  it('returns full length for whitespace-only content to end of string', () => {
    expect(leadingWhitespaceLen('   ', 0)).toBe(3)
  })
})
