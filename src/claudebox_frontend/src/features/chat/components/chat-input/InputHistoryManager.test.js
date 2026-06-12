/** Tests for InputHistoryManager navigation state machine. */

import { describe, expect, it } from 'vitest'
import InputHistoryManager from './InputHistoryManager'

function createManager({ history = [], drafts = { current: '', stack: [] } } = {}) {
  const m = new InputHistoryManager()
  m.setHistory(history)
  m.setDrafts(drafts)
  return m
}

describe('InputHistoryManager', () => {
  describe('navigateUp', () => {
    it('returns not handled when cursor is not at start', () => {
      const m = createManager({ history: ['a'] })
      expect(m.navigateUp(false)).toEqual({ handled: false, value: null })
    })

    it('goes to newest draft from fresh', () => {
      const m = createManager({ drafts: { current: '', stack: ['old', 'new'] } })
      const result = m.navigateUp(true)
      expect(result).toEqual({ handled: true, value: 'new' })
      expect(m.navState).toEqual({ source: 'draft', index: 0 })
    })

    it('goes to newest history from fresh when no drafts', () => {
      const m = createManager({ history: ['first', 'second'] })
      const result = m.navigateUp(true)
      expect(result).toEqual({ handled: true, value: 'second' })
      expect(m.navState).toEqual({ source: 'history', index: 0 })
    })

    it('returns not handled when nothing to navigate', () => {
      const m = createManager()
      expect(m.navigateUp(true)).toEqual({ handled: false, value: null })
    })

    it('navigates through drafts LIFO then to history', () => {
      const m = createManager({
        drafts: { current: '', stack: ['d1', 'd2'] },
        history: ['h1'],
      })
      m.navigateUp(true)
      expect(m.navState).toEqual({ source: 'draft', index: 0 })

      m.navigateUp(true)
      expect(m.navState).toEqual({ source: 'draft', index: 1 })

      const toHistory = m.navigateUp(true)
      expect(toHistory).toEqual({ handled: true, value: 'h1' })
      expect(m.navState).toEqual({ source: 'history', index: 0 })
    })

    it('stays at oldest history item', () => {
      const m = createManager({ history: ['only'] })
      m.navigateUp(true)
      const result = m.navigateUp(true)
      expect(result).toEqual({ handled: true, value: null })
      expect(m.navState).toEqual({ source: 'history', index: 0 })
    })
  })

  describe('navigateDown', () => {
    it('returns not handled when cursor is not at end', () => {
      const m = createManager({ history: ['a'] })
      m.navigateUp(true)
      expect(m.navigateDown(false, '')).toEqual({ handled: false, value: null, pushToStack: null })
    })

    it('pushes to stack from fresh with text', () => {
      const m = createManager()
      const result = m.navigateDown(true, 'typed text')
      expect(result).toEqual({ handled: true, value: '', pushToStack: 'typed text' })
    })

    it('returns not handled from fresh with empty text', () => {
      const m = createManager()
      expect(m.navigateDown(true, '')).toEqual({ handled: false, value: null, pushToStack: null })
    })

    it('navigates from history to drafts to fresh', () => {
      const m = createManager({
        drafts: { current: 'saved', stack: ['d1'] },
        history: ['h1', 'h2'],
      })

      // Navigate up: draft -> history[0] -> history[1]
      m.navigateUp(true)
      m.navigateUp(true)
      m.navigateUp(true)
      expect(m.navState).toEqual({ source: 'history', index: 1 })

      // Down: newer history
      m.navigateDown(true, '')
      expect(m.navState).toEqual({ source: 'history', index: 0 })

      // Down: to draft
      m.navigateDown(true, '')
      expect(m.navState).toEqual({ source: 'draft', index: 0 })

      // Down: back to fresh with drafts.current
      const fresh = m.navigateDown(true, '')
      expect(fresh).toEqual({ handled: true, value: 'saved', pushToStack: null })
      expect(m.navState).toEqual({ source: null, index: -1 })
    })

    it('goes from history directly to fresh when no drafts', () => {
      const m = createManager({ history: ['h1'], drafts: { current: 'wip', stack: [] } })
      m.navigateUp(true)
      const result = m.navigateDown(true, '')
      expect(result).toEqual({ handled: true, value: 'wip', pushToStack: null })
      expect(m.navState).toEqual({ source: null, index: -1 })
    })
  })

  describe('getDraftItem / getHistoryItem', () => {
    it('returns items with 0 = newest', () => {
      const m = createManager({
        history: ['first', 'second', 'third'],
        drafts: { current: '', stack: ['a', 'b', 'c'] },
      })
      expect(m.getDraftItem(0)).toBe('c')
      expect(m.getDraftItem(2)).toBe('a')
      expect(m.getHistoryItem(0)).toBe('third')
      expect(m.getHistoryItem(2)).toBe('first')
    })
  })

  describe('updateCurrentItem', () => {
    it('returns null when in fresh state', () => {
      const m = createManager()
      expect(m.updateCurrentItem('new')).toBeNull()
    })

    it('returns draft source and real index', () => {
      const m = createManager({ drafts: { current: '', stack: ['a', 'b'] } })
      m.navigateUp(true) // draft index 0 = stack[1] = 'b'
      expect(m.updateCurrentItem('edited')).toEqual({ source: 'draft', realIndex: 1 })
    })

    it('returns history source and real index', () => {
      const m = createManager({ history: ['a', 'b', 'c'] })
      m.navigateUp(true) // history index 0 = history[2] = 'c'
      expect(m.updateCurrentItem('edited')).toEqual({ source: 'history', realIndex: 2 })
    })
  })

  describe('prepareSubmit', () => {
    it('returns non-draft result from fresh', () => {
      const m = createManager({ drafts: { current: '', stack: ['d1'] } })
      const result = m.prepareSubmit('hello')
      expect(result.fromDraft).toBe(false)
      expect(result.newStack).toEqual(['d1'])
      expect(m.navState).toEqual({ source: null, index: -1 })
    })

    it('removes draft from stack on submit', () => {
      const m = createManager({ drafts: { current: '', stack: ['d1', 'd2', 'd3'] } })
      m.navigateUp(true) // draft index 0 = stack[2] = 'd3'
      const result = m.prepareSubmit('d3')
      expect(result.fromDraft).toBe(true)
      expect(result.draftIndex).toBe(0)
      expect(result.newStack).toEqual(['d1', 'd2'])
    })
  })

  describe('resetNavigation', () => {
    it('resets to fresh state', () => {
      const m = createManager({ history: ['a'] })
      m.navigateUp(true)
      expect(m.navState.source).toBe('history')
      m.resetNavigation()
      expect(m.navState).toEqual({ source: null, index: -1 })
    })
  })

  describe('recentAdditions', () => {
    it('includes recent additions in effective history', () => {
      const m = createManager({ history: ['a'] })
      m.addRecentAddition('b')
      expect(m.getHistoryItem(0)).toBe('b')
      expect(m.getHistoryItem(1)).toBe('a')
    })

    it('syncs recent additions when present in history', () => {
      const m = createManager({ history: ['a', 'b'] })
      m.addRecentAddition('b')
      m.syncRecentAdditions()
      expect(m.getHistoryItem(0)).toBe('b')
      expect(m.getHistoryItem(1)).toBe('a')
    })
  })
})
