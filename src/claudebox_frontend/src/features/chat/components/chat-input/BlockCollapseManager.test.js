/** Tests for BlockCollapseManager collapse/expand operations. */

import { describe, expect, it } from 'vitest'
import BlockCollapseManager from './BlockCollapseManager'

describe('BlockCollapseManager', () => {
  describe('collapseLocal', () => {
    it('collapses block enclosing cursor', () => {
      const m = new BlockCollapseManager()
      const value = 'before <foo>content</foo> after'
      const result = m.collapseLocal(value, 15) // cursor inside <foo>content</foo>
      expect(result).not.toBeNull()
      expect(result.value).toContain('<foo...1>')
      expect(result.value).toContain('before')
      expect(result.value).toContain('after')
      expect(m.hasCollapsed).toBe(true)
    })

    it('returns null when cursor not in a block', () => {
      const m = new BlockCollapseManager()
      expect(m.collapseLocal('no blocks here', 5)).toBeNull()
    })
  })

  describe('collapseAll', () => {
    it('collapses all blocks', () => {
      const m = new BlockCollapseManager()
      const value = '<foo>a</foo> text <bar>b</bar>'
      const result = m.collapseAll(value)
      expect(result.value).not.toContain('</foo>')
      expect(result.value).not.toContain('</bar>')
      expect(result.value).toContain('text')
      expect(m.hasCollapsed).toBe(true)
    })
  })

  describe('expandLocal', () => {
    it('expands collapsed placeholder at cursor', () => {
      const m = new BlockCollapseManager()
      const collapsed = m.collapseLocal('<foo>content</foo>', 5)
      const result = m.expandLocal(collapsed.value, 3)
      expect(result).not.toBeNull()
      expect(result.value).toBe('<foo>content</foo>')
      expect(m.hasCollapsed).toBe(false)
    })

    it('returns null when cursor not on a placeholder', () => {
      const m = new BlockCollapseManager()
      m.collapseLocal('<foo>x</foo>', 5)
      expect(m.expandLocal('no placeholder here', 5)).toBeNull()
    })
  })

  describe('expandAll', () => {
    it('expands all collapsed placeholders', () => {
      const m = new BlockCollapseManager()
      const value = '<foo>a</foo> <bar>b</bar>'
      const collapsed = m.collapseAll(value)
      const result = m.expandAll(collapsed.value)
      expect(result.value).toBe(value)
      expect(m.hasCollapsed).toBe(false)
    })
  })

  describe('expandBeforeSubmit', () => {
    it('no-ops when nothing collapsed', () => {
      const m = new BlockCollapseManager()
      const result = m.expandBeforeSubmit('hello')
      expect(result.value).toBe('hello')
    })

    it('expands all when has collapsed', () => {
      const m = new BlockCollapseManager()
      const collapsed = m.collapseLocal('<foo>content</foo>', 5)
      const result = m.expandBeforeSubmit(collapsed.value)
      expect(result.value).toBe('<foo>content</foo>')
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const m = new BlockCollapseManager()
      m.collapseLocal('<foo>x</foo>', 5)
      expect(m.hasCollapsed).toBe(true)
      m.reset()
      expect(m.hasCollapsed).toBe(false)
    })
  })
})
