/** Tests for xmlBlocks.js XML block parsing. */

import { describe, expect, it } from 'vitest'
import { findAllBlocks, findEnclosingBlock, findEnclosingCollapsed } from './xmlBlocks'

describe('findAllBlocks', () => {
  it('finds a single block', () => {
    const blocks = findAllBlocks('<foo>content</foo>')

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ tagName: 'foo', start: 0, end: 18 })
  })

  it('finds multiple blocks', () => {
    const blocks = findAllBlocks('<a>1</a><b>2</b>')

    expect(blocks).toHaveLength(2)
    expect(blocks[0].tagName).toBe('a')
    expect(blocks[1].tagName).toBe('b')
  })

  it('handles nested same-name tags', () => {
    const blocks = findAllBlocks('<div><div>inner</div></div>')

    expect(blocks).toHaveLength(2)
    // Outer block found first (regex matches first <div> at index 0)
    expect(blocks[0]).toMatchObject({ tagName: 'div', fullMatch: '<div><div>inner</div></div>' })
    // Inner block found second
    expect(blocks[1]).toMatchObject({ tagName: 'div', fullMatch: '<div>inner</div>' })
  })

  it('returns empty for no blocks', () => {
    expect(findAllBlocks('plain text')).toHaveLength(0)
  })

  it('ignores unclosed tags', () => {
    expect(findAllBlocks('<open>no close')).toHaveLength(0)
  })
})

describe('findEnclosingBlock', () => {
  it('finds block enclosing cursor', () => {
    const result = findEnclosingBlock('<tag>hello</tag>', 7)

    expect(result).not.toBeNull()
    expect(result.tagName).toBe('tag')
  })

  it('returns innermost block for nested tags', () => {
    const value = '<outer><inner>text</inner></outer>'
    const result = findEnclosingBlock(value, 15) // inside 'text'

    expect(result.tagName).toBe('inner')
  })

  it('returns null when cursor is outside all blocks', () => {
    expect(findEnclosingBlock('before<tag>x</tag>after', 2)).toBeNull()
  })
})

describe('findEnclosingCollapsed', () => {
  it('finds collapsed placeholder at cursor', () => {
    const result = findEnclosingCollapsed('text <foo...1> more', 8)

    expect(result).not.toBeNull()
    expect(result.tagName).toBe('foo')
    expect(result.placeholder).toBe('<foo...1>')
  })

  it('returns null when cursor is not at placeholder', () => {
    expect(findEnclosingCollapsed('text <foo...1> more', 2)).toBeNull()
  })

  it('returns null when no collapsed placeholders exist', () => {
    expect(findEnclosingCollapsed('plain text', 5)).toBeNull()
  })
})
