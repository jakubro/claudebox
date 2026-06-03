/** Pure collapse/expand state machine for XML block elements. */

import {
  findAllBlocks,
  findEnclosingBlock,
  findEnclosingCollapsed,
} from '../../../../utils/xmlBlocks'

/**
 * Manage collapse/expand operations for XML blocks in textarea content.
 *
 * All operations are pure text transformations: take value + cursor position,
 * return transformed value + new cursor. No React or DOM dependencies.
 */
export default class BlockCollapseManager {
  constructor() {
    this._collapsed = new Map()
    this._counter = 0
  }

  /** Whether any blocks are currently collapsed. */
  get hasCollapsed() {
    return this._collapsed.size > 0
  }

  /**
   * Collapse the XML block enclosing the cursor.
   * @param {string} value - Current textarea value.
   * @param {number} cursor - Current cursor position.
   * @returns {{ value: string, cursor: number }|null} New state, or null if no block found.
   */
  collapseLocal(value, cursor) {
    const block = findEnclosingBlock(value, cursor)
    if (!block) {
      return null
    }

    const id = ++this._counter
    const placeholder = `<${block.tagName}...${id}>`
    this._collapsed.set(placeholder, block.fullMatch)

    const before = value.slice(0, block.start)
    const after = value.slice(block.end)
    return { value: before + placeholder + after, cursor: block.start + placeholder.length }
  }

  /**
   * Collapse all XML blocks (innermost first, repeatedly until none remain).
   * @param {string} value - Current textarea value.
   * @returns {{ value: string }}
   */
  collapseAll(value) {
    let changed = true
    while (changed) {
      changed = false
      const blocks = findAllBlocks(value)
      const innermost = blocks.filter(
        b => !blocks.some(other => other.start > b.start && other.end < b.end),
      )
      const assignments = innermost.map(m => ({
        ...m,
        id: ++this._counter,
      }))
      for (let i = assignments.length - 1; i >= 0; i--) {
        const m = assignments[i]
        const placeholder = `<${m.tagName}...${m.id}>`
        this._collapsed.set(placeholder, m.fullMatch)
        value = value.slice(0, m.start) + placeholder + value.slice(m.end)
        changed = true
      }
    }
    return { value }
  }

  /**
   * Expand the collapsed placeholder enclosing the cursor.
   * @param {string} value - Current textarea value.
   * @param {number} cursor - Current cursor position.
   * @returns {{ value: string, cursor: number }|null} New state, or null if no placeholder found.
   */
  expandLocal(value, cursor) {
    const collapsed = findEnclosingCollapsed(value, cursor)
    if (!collapsed) {
      return null
    }
    const original = this._collapsed.get(collapsed.placeholder)
    if (!original) {
      return null
    }

    this._collapsed.delete(collapsed.placeholder)
    const before = value.slice(0, collapsed.start)
    const after = value.slice(collapsed.end)
    return { value: before + original + after, cursor: collapsed.start + original.length }
  }

  /**
   * Expand all collapsed placeholders.
   * @param {string} value - Current textarea value.
   * @returns {{ value: string }}
   */
  expandAll(value) {
    const entries = [...this._collapsed.entries()].reverse()
    for (const [placeholder, original] of entries) {
      value = value.replaceAll(placeholder, original)
    }
    this._collapsed.clear()
    return { value }
  }

  /**
   * Expand all collapsed placeholders before submit (no-op if none collapsed).
   * @param {string} value - Current textarea value.
   * @returns {{ value: string }}
   */
  expandBeforeSubmit(value) {
    if (this._collapsed.size === 0) {
      return { value }
    }
    return this.expandAll(value)
  }

  /** Reset all collapse state. */
  reset() {
    this._collapsed.clear()
    this._counter = 0
  }
}
