/** Tests for listMarker utility — markdown list-line parsing. */

import { describe, expect, it } from 'vitest'
import { nextMarker, parseListLine } from './listMarker'

describe('parseListLine — bullets', () => {
  it('parses dash bullet', () => {
    expect(parseListLine('- foo')).toEqual({
      leadingWhitespace: '',
      marker: '- ',
      markerType: 'bullet',
      numberValue: null,
      bulletChar: '-',
      content: 'foo',
    })
  })

  it('parses asterisk bullet', () => {
    expect(parseListLine('* foo')).toMatchObject({ marker: '* ', bulletChar: '*' })
  })

  it('parses plus bullet', () => {
    expect(parseListLine('+ foo')).toMatchObject({ marker: '+ ', bulletChar: '+' })
  })

  it('parses indented bullet — leading whitespace captured', () => {
    expect(parseListLine('  - sub')).toMatchObject({
      leadingWhitespace: '  ',
      marker: '- ',
      content: 'sub',
    })
  })

  it('parses bullet with empty content (line ends right after marker)', () => {
    expect(parseListLine('- ')).toMatchObject({ marker: '- ', content: '' })
  })

  it('parses bullet with multi-word content', () => {
    expect(parseListLine('- foo bar baz')).toMatchObject({ content: 'foo bar baz' })
  })
})

describe('parseListLine — numbered', () => {
  it('parses numbered with dot', () => {
    expect(parseListLine('1. foo')).toEqual({
      leadingWhitespace: '',
      marker: '1. ',
      markerType: 'numbered-dot',
      numberValue: 1,
      bulletChar: null,
      content: 'foo',
    })
  })

  it('parses numbered with paren', () => {
    expect(parseListLine('1) foo')).toMatchObject({
      marker: '1) ',
      markerType: 'numbered-paren',
      numberValue: 1,
    })
  })

  it('parses multi-digit numbered', () => {
    expect(parseListLine('42. foo')).toMatchObject({ numberValue: 42, marker: '42. ' })
  })

  it('parses indented numbered', () => {
    expect(parseListLine('   1. nested')).toMatchObject({
      leadingWhitespace: '   ',
      marker: '1. ',
      content: 'nested',
    })
  })

  it('parses numbered with empty content', () => {
    expect(parseListLine('1. ')).toMatchObject({ marker: '1. ', content: '' })
  })
})

describe('parseListLine — task lists', () => {
  it('parses unchecked task', () => {
    expect(parseListLine('- [ ] foo')).toEqual({
      leadingWhitespace: '',
      marker: '- [ ] ',
      markerType: 'task',
      numberValue: null,
      bulletChar: '-',
      content: 'foo',
    })
  })

  it('parses checked task (lowercase x)', () => {
    expect(parseListLine('- [x] foo')).toMatchObject({ marker: '- [x] ', markerType: 'task' })
  })

  it('parses checked task (uppercase X)', () => {
    expect(parseListLine('- [X] foo')).toMatchObject({ marker: '- [X] ' })
  })

  it('parses task with star bullet', () => {
    expect(parseListLine('* [ ] foo')).toMatchObject({ bulletChar: '*', markerType: 'task' })
  })

  it('parses task with plus bullet', () => {
    expect(parseListLine('+ [ ] foo')).toMatchObject({ bulletChar: '+', markerType: 'task' })
  })

  it('parses indented task', () => {
    expect(parseListLine('  - [ ] foo')).toMatchObject({
      leadingWhitespace: '  ',
      markerType: 'task',
    })
  })

  it('parses task with empty content', () => {
    expect(parseListLine('- [ ] ')).toMatchObject({ content: '', markerType: 'task' })
  })
})

describe('parseListLine — negatives', () => {
  it('returns null for empty string', () => {
    expect(parseListLine('')).toBeNull()
  })

  it('returns null for plain prose', () => {
    expect(parseListLine('hello world')).toBeNull()
  })

  it('returns null for bullet without trailing space (-foo)', () => {
    expect(parseListLine('-foo')).toBeNull()
  })

  it('returns null for bare dash without space', () => {
    expect(parseListLine('-')).toBeNull()
  })

  it('returns null for indented bare dash', () => {
    expect(parseListLine('  -')).toBeNull()
  })

  it('returns null for numbered without trailing space (1.foo)', () => {
    expect(parseListLine('1.foo')).toBeNull()
  })

  it('returns null for orphan dot (no leading digit)', () => {
    expect(parseListLine('. foo')).toBeNull()
  })

  it('returns null for whitespace-only line', () => {
    expect(parseListLine('   ')).toBeNull()
  })

  it('returns null for heading-style line', () => {
    expect(parseListLine('# heading')).toBeNull()
  })
})

describe('nextMarker', () => {
  it('continues bullet with same character', () => {
    expect(nextMarker({ markerType: 'bullet', bulletChar: '-' })).toBe('- ')
    expect(nextMarker({ markerType: 'bullet', bulletChar: '*' })).toBe('* ')
    expect(nextMarker({ markerType: 'bullet', bulletChar: '+' })).toBe('+ ')
  })

  it('continues task as always-unchecked regardless of prior state', () => {
    expect(nextMarker({ markerType: 'task', bulletChar: '-' })).toBe('- [ ] ')
    // Prior item was checked; new item is still unchecked.
    expect(nextMarker({ markerType: 'task', bulletChar: '*' })).toBe('* [ ] ')
  })

  it('increments numbered-dot', () => {
    expect(nextMarker({ markerType: 'numbered-dot', numberValue: 1 })).toBe('2. ')
    expect(nextMarker({ markerType: 'numbered-dot', numberValue: 42 })).toBe('43. ')
  })

  it('increments numbered-paren', () => {
    expect(nextMarker({ markerType: 'numbered-paren', numberValue: 1 })).toBe('2) ')
    expect(nextMarker({ markerType: 'numbered-paren', numberValue: 99 })).toBe('100) ')
  })
})
