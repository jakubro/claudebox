/** Tests for firstGrapheme — collapsed-column header label compression. */

import { describe, expect, it } from 'vitest'
import { firstGrapheme } from './grapheme'

describe('firstGrapheme', () => {
  it('uppercases the first letter of a plain label', () => {
    expect(firstGrapheme('Backlog')).toBe('B')
    expect(firstGrapheme('in progress')).toBe('I')
  })

  it('preserves single-codepoint emoji', () => {
    expect(firstGrapheme('🚀 Ready')).toBe('🚀')
  })

  it('preserves ZWJ emoji sequences as a single grapheme', () => {
    // Family emoji: man + ZWJ + woman + ZWJ + girl
    expect(firstGrapheme('👨‍👩‍👧 Family')).toBe('👨‍👩‍👧')
  })

  it('preserves leading symbol without uppercase mutation', () => {
    expect(firstGrapheme('#tagged')).toBe('#')
  })

  it('returns empty string for falsy input', () => {
    expect(firstGrapheme('')).toBe('')
    expect(firstGrapheme(null)).toBe('')
    expect(firstGrapheme(undefined)).toBe('')
  })

  it('handles single-character labels', () => {
    expect(firstGrapheme('B')).toBe('B')
    expect(firstGrapheme('b')).toBe('B')
  })
})
