/** Tests for XML escape/unescape utilities. */

import { describe, expect, it } from 'vitest'
import { escapeXml, unescapeXml } from './xml'

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b')
  })

  it('escapes angle brackets', () => {
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;')
  })

  it('escapes quotes', () => {
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;')
  })

  it('handles null/empty', () => {
    expect(escapeXml(null)).toBe('')
    expect(escapeXml('')).toBe('')
  })
})

describe('unescapeXml', () => {
  it('unescapes ampersand', () => {
    expect(unescapeXml('a &amp; b')).toBe('a & b')
  })

  it('unescapes angle brackets', () => {
    expect(unescapeXml('&lt;tag&gt;')).toBe('<tag>')
  })

  it('unescapes quotes', () => {
    expect(unescapeXml('&quot;quoted&quot;')).toBe('"quoted"')
  })

  it('handles null/empty', () => {
    expect(unescapeXml(null)).toBe('')
    expect(unescapeXml('')).toBe('')
  })
})
