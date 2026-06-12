/** Pure navigation state machine for input history with draft stack. */

/**
 * Manage bidirectional navigation across fresh input, drafts (LIFO), and history (newest-first).
 *
 * Data model:
 * - drafts.stack: ["a", "b"] where "b" is most recently pushed
 * - history: submitted messages, newest last
 * - Navigation: index-based traversal through [fresh | drafts (LIFO) | history (newest first)]
 *
 * Navigation state:
 * - source: null (fresh), 'draft', or 'history'
 * - index: position within source (0 = newest item in that source)
 */
export default class InputHistoryManager {
  constructor() {
    this._source = null
    this._index = -1
    this._history = []
    this._recentAdditions = []
    this._drafts = { current: '', stack: [] }
  }

  /** Current navigation state. */
  get navState() {
    return { source: this._source, index: this._index }
  }

  /** Set history items (call from hook when state changes). */
  setHistory(items) {
    this._history = items
  }

  /** Set draft state (call from hook when state changes). */
  setDrafts(drafts) {
    this._drafts = drafts
  }

  /** Track recently added items for immediate access before state flush. */
  addRecentAddition(content) {
    this._recentAdditions.push(content)
  }

  /** Sync recent additions - remove items that are now in actual history. */
  syncRecentAdditions() {
    if (this._recentAdditions.length > 0 && this._history.length > 0) {
      const historySet = new Set(this._history)
      this._recentAdditions = this._recentAdditions.filter(item => !historySet.has(item))
    }
  }

  /** Get effective history including recent additions not yet flushed to state. */
  get _effectiveHistory() {
    return [...this._history, ...this._recentAdditions]
  }

  /** Get item from draft stack by index (0 = newest = stack[stack.length-1]). */
  getDraftItem(index) {
    const stack = this._drafts.stack || []
    return stack[stack.length - 1 - index]
  }

  /** Get item from history by index (0 = newest = history[history.length-1]). */
  getHistoryItem(index) {
    const h = this._effectiveHistory
    return h[h.length - 1 - index]
  }

  /**
   * Navigate to previous (older) item (Up arrow).
   * @param {boolean} cursorAtStart - Whether cursor is at the start of the textarea.
   * @returns {{ handled: boolean, value: string|null }}
   */
  navigateUp(cursorAtStart) {
    if (!cursorAtStart) {
      return { handled: false, value: null }
    }

    const stack = this._drafts.stack || []
    const effectiveHistory = this._effectiveHistory

    if (this._source === null) {
      if (stack.length > 0) {
        this._source = 'draft'
        this._index = 0
        return { handled: true, value: this.getDraftItem(0) ?? '' }
      }
      if (effectiveHistory.length > 0) {
        this._source = 'history'
        this._index = 0
        return { handled: true, value: this.getHistoryItem(0) ?? '' }
      }
      return { handled: false, value: null }
    }

    if (this._source === 'draft') {
      if (this._index < stack.length - 1) {
        this._index += 1
        return { handled: true, value: this.getDraftItem(this._index) ?? '' }
      }
      if (effectiveHistory.length > 0) {
        this._source = 'history'
        this._index = 0
        return { handled: true, value: this.getHistoryItem(0) ?? '' }
      }
      return { handled: true, value: null }
    }

    if (this._source === 'history') {
      if (this._index < effectiveHistory.length - 1) {
        this._index += 1
        return { handled: true, value: this.getHistoryItem(this._index) ?? '' }
      }
      return { handled: true, value: null }
    }

    return { handled: false, value: null }
  }

  /**
   * Navigate to next (newer) item (Down arrow).
   * @param {boolean} cursorAtEnd - Whether cursor is at the end of the textarea.
   * @param {string} currentValue - Current textarea value.
   * @returns {{ handled: boolean, value: string|null, pushToStack: string|null }}
   */
  navigateDown(cursorAtEnd, currentValue) {
    if (!cursorAtEnd) {
      return { handled: false, value: null, pushToStack: null }
    }

    const stack = this._drafts.stack || []

    if (this._source === null) {
      if (currentValue.trim()) {
        this._source = null
        this._index = -1
        return { handled: true, value: '', pushToStack: currentValue }
      }
      return { handled: false, value: null, pushToStack: null }
    }

    if (this._source === 'history') {
      if (this._index > 0) {
        this._index -= 1
        return { handled: true, value: this.getHistoryItem(this._index) ?? '', pushToStack: null }
      }
      if (stack.length > 0) {
        this._source = 'draft'
        this._index = stack.length - 1
        return {
          handled: true,
          value: this.getDraftItem(stack.length - 1) ?? '',
          pushToStack: null,
        }
      }
      this._source = null
      this._index = -1
      return { handled: true, value: this._drafts.current || '', pushToStack: null }
    }

    if (this._source === 'draft') {
      if (this._index > 0) {
        this._index -= 1
        return { handled: true, value: this.getDraftItem(this._index) ?? '', pushToStack: null }
      }
      this._source = null
      this._index = -1
      return { handled: true, value: this._drafts.current || '', pushToStack: null }
    }

    return { handled: false, value: null, pushToStack: null }
  }

  /**
   * Determine which source/index to update when editing the current item in-place.
   * @param {string} _newValue - The new value (unused, kept for API clarity).
   * @returns {{ source: string, realIndex: number }|null}
   */
  updateCurrentItem(_newValue) {
    const { source, index } = this.navState
    if (source === 'draft') {
      const stack = this._drafts.stack || []
      const realIndex = stack.length - 1 - index
      if (realIndex >= 0 && realIndex < stack.length) {
        return { source, realIndex }
      }
    } else if (source === 'history') {
      const realIndex = this._history.length - 1 - index
      if (realIndex >= 0 && realIndex < this._history.length) {
        return { source, realIndex }
      }
    }
    return null
  }

  /**
   * Prepare for submit: compute cleanup info without side effects.
   * @param {string} content - Content being submitted.
   * @returns {{ content: string, fromDraft: boolean, draftIndex: number|null, newStack: string[] }}
   */
  prepareSubmit(content) {
    const stack = this._drafts.stack || []
    const result = { content, fromDraft: false, draftIndex: null, newStack: [...stack] }

    if (this._source === 'draft') {
      result.fromDraft = true
      result.draftIndex = this._index
      const realIndex = stack.length - 1 - this._index
      if (realIndex >= 0 && realIndex < stack.length) {
        result.newStack = [...stack.slice(0, realIndex), ...stack.slice(realIndex + 1)]
      }
    }

    this._source = null
    this._index = -1
    return result
  }

  /** Reset navigation state to fresh. */
  resetNavigation() {
    this._source = null
    this._index = -1
  }
}
