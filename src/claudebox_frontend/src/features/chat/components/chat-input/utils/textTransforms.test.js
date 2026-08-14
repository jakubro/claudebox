/** Tests for textTransforms - pure text-editing operations shared by composer and reply boxes. */

import { describe, expect, it } from 'vitest'
import { shiftEnter, tabKey, wrapInTags, wrapPair } from './textTransforms'

describe('wrapInTags', () => {
  it('wraps a selection and lands the caret after the closing tag', () => {
    expect(wrapInTags('hello world', 6, 11)).toEqual({
      value: 'hello <this>world</this>',
      selStart: 24,
      selEnd: 24,
    })
  })

  it('inserts an empty pair at the caret with no selection, caret between tags', () => {
    expect(wrapInTags('hello', 5, 5)).toEqual({
      value: 'hello<this></this>',
      selStart: 11,
      selEnd: 11,
    })
  })

  it('wraps at position 0', () => {
    expect(wrapInTags('hello', 0, 0)).toEqual({
      value: '<this></this>hello',
      selStart: 6,
      selEnd: 6,
    })
  })

  it('wraps at end of text', () => {
    const result = wrapInTags('hello', 5, 5)
    expect(result.value.endsWith('</this>')).toBe(true)
  })
})

describe('shiftEnter', () => {
  it('inserts a plain newline on prose with no indent', () => {
    expect(shiftEnter('hello', 5)).toEqual({ value: 'hello\n', selStart: 6, selEnd: 6 })
  })

  it('inherits leading whitespace on the new line', () => {
    expect(shiftEnter('   hello', 8)).toEqual({ value: '   hello\n   ', selStart: 12, selEnd: 12 })
  })

  it('inherits leading whitespace on a mid-content split', () => {
    expect(shiftEnter('   hello world', 9)).toEqual({
      value: '   hello \n   world',
      selStart: 13,
      selEnd: 13,
    })
  })

  it('continues a dash bullet', () => {
    expect(shiftEnter('- foo', 5)).toEqual({ value: '- foo\n- ', selStart: 8, selEnd: 8 })
  })

  it('continues a numbered list, incrementing the marker', () => {
    expect(shiftEnter('1. foo', 6)).toEqual({ value: '1. foo\n2. ', selStart: 10, selEnd: 10 })
  })

  it('always continues a task marker as unchecked, regardless of prior state', () => {
    expect(shiftEnter('- [x] foo', 9).value).toBe('- [x] foo\n- [ ] ')
  })

  it('inherits indent plus marker on an indented sub-bullet', () => {
    expect(shiftEnter('  - sub', 7).value).toBe('  - sub\n  - ')
  })

  it('inserts the marker at a mid-content split, not at end of line', () => {
    expect(shiftEnter('- foo bar', 6)).toEqual({ value: '- foo \n- bar', selStart: 9, selEnd: 9 })
  })

  it('exits the list on an empty marker', () => {
    expect(shiftEnter('- ', 2)).toEqual({ value: '\n', selStart: 1, selEnd: 1 })
  })

  it('preserves indent on both lines when exiting an indented empty bullet', () => {
    expect(shiftEnter('  - ', 4)).toEqual({ value: '  \n  ', selStart: 5, selEnd: 5 })
  })

  it('ignores a live selection - splits at the anchor only', () => {
    // selStart=5 (anchor), a caller-provided selEnd is irrelevant to this transform.
    expect(shiftEnter('hello world', 5)).toEqual({
      value: 'hello\n world',
      selStart: 6,
      selEnd: 6,
    })
  })

  it('handles the caret at position 0', () => {
    expect(shiftEnter('hello', 0)).toEqual({ value: '\nhello', selStart: 1, selEnd: 1 })
  })
})

describe('tabKey - indent', () => {
  it('inserts 2 spaces at the caret in the content zone', () => {
    expect(tabKey('hello world', 5, 5, false)).toEqual({
      value: 'hello   world',
      selStart: 7,
      selEnd: 7,
    })
  })

  it('snaps 0 leading whitespace up to 2 at position 0', () => {
    expect(tabKey('hello', 0, 0, false)).toEqual({ value: '  hello', selStart: 2, selEnd: 2 })
  })

  it('snaps 1 leading whitespace up to 2 (not 3)', () => {
    expect(tabKey(' hello', 0, 0, false).value).toBe('  hello')
  })

  it('snaps 2 leading whitespace up to 4 with caret at the boundary', () => {
    expect(tabKey('  hello', 2, 2, false)).toEqual({ value: '    hello', selStart: 4, selEnd: 4 })
  })

  it('replaces a single-line selection with 2 spaces', () => {
    expect(tabKey('hello world', 6, 11, false)).toEqual({
      value: 'hello   ',
      selStart: 8,
      selEnd: 8,
    })
  })

  it('indents at end of text', () => {
    expect(tabKey('hello', 5, 5, false)).toEqual({ value: 'hello  ', selStart: 7, selEnd: 7 })
  })

  it('indents every line in a multi-line selection', () => {
    expect(tabKey('a\nb', 0, 3, false)).toEqual({ value: '  a\n  b', selStart: 0, selEnd: 7 })
  })

  it('indents only the first line when the selection ends right after its newline', () => {
    expect(tabKey('a\nb', 0, 2, false).value).toBe('  a\nb')
  })
})

describe('tabKey - dedent', () => {
  it('dedents 2 leading spaces to 0', () => {
    expect(tabKey('  hello', 2, 2, true)).toEqual({ value: 'hello', selStart: 0, selEnd: 0 })
  })

  it('dedents 3 leading spaces to 2', () => {
    expect(tabKey('   hello', 3, 3, true)).toEqual({ value: '  hello', selStart: 2, selEnd: 2 })
  })

  it('dedents 1 leading space to 0', () => {
    expect(tabKey(' hello', 1, 1, true).value).toBe('hello')
  })

  it('returns null on an unindented line (no-op, distinguishable from a real edit)', () => {
    expect(tabKey('hello', 0, 0, true)).toBeNull()
  })

  it('dedents multiple lines with different leading whitespace each', () => {
    expect(tabKey('  a\n    b\nc', 0, 11, true)).toEqual({
      value: 'a\n  b\nc',
      selStart: 0,
      selEnd: 7,
    })
  })

  it('snap-dedents a single-line selection at the line level, not just the selection', () => {
    // Selects "llo" on a line with 2 leading spaces - the whole line's indent is snapped.
    expect(tabKey('  hello', 4, 7, true)).toEqual({ value: 'hello', selStart: 2, selEnd: 5 })
  })
})

describe('wrapPair', () => {
  it('wraps a selection in matching quotes', () => {
    expect(wrapPair('hello world', 6, 11, "'")).toEqual({
      value: "hello 'world'",
      selStart: 13,
      selEnd: 13,
    })
  })

  it('wraps a selection in matching brackets', () => {
    expect(wrapPair('value', 0, 5, '(')).toEqual({ value: '(value)', selStart: 7, selEnd: 7 })
  })

  it('returns null with no selection', () => {
    expect(wrapPair('hello', 3, 3, "'")).toBeNull()
  })

  it('returns null for a non-pairing key', () => {
    expect(wrapPair('hello world', 6, 11, 'a')).toBeNull()
  })

  it('wraps a selection starting at position 0', () => {
    expect(wrapPair('abc', 0, 3, '[')).toEqual({ value: '[abc]', selStart: 5, selEnd: 5 })
  })
})
