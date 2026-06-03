/** Tests for useInputHistory hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useInputHistory from './useInputHistory'

// Stable defaults
const EMPTY_EVENTS_REF = { current: [] }
const DEFAULT_DRAFTS = { current: '', stack: [] }
const STORAGE_KEY = 'inputHistory:test-session'

/**
 * Seed localStorage with history items before rendering.
 */
const seedHistory = items => localStorage.setItem(STORAGE_KEY, JSON.stringify(items))

describe('useInputHistory', () => {
  let mockTextarea
  let textareaRef
  let resizeTextarea
  let saveDrafts

  beforeEach(() => {
    localStorage.clear()
    mockTextarea = { value: '', selectionStart: 0, selectionEnd: 0 }
    textareaRef = { current: mockTextarea }
    resizeTextarea = vi.fn()
    saveDrafts = vi.fn()
  })

  afterEach(() => {
    localStorage.clear()
  })

  /**
   * Render the useInputHistory hook with default or custom options.
   */
  const renderInputHistory = (opts = {}) =>
    renderHook(
      ({ sessionId, eventsRef, eventsLength, drafts }) =>
        // useInputHistory consumes drafts via a ref (kept live by ChatInput's
        // direct-write path). Tests pass a static object; wrap it so the hook
        // reads `.current` on every navigation call.
        useInputHistory(
          sessionId,
          eventsRef,
          eventsLength,
          { current: drafts },
          saveDrafts,
          textareaRef,
          resizeTextarea,
        ),
      {
        initialProps: {
          sessionId: opts.sessionId ?? 'test-session',
          eventsRef: opts.eventsRef ?? EMPTY_EVENTS_REF,
          eventsLength: opts.eventsLength ?? opts.eventsRef?.current?.length ?? 0,
          drafts: opts.drafts ?? DEFAULT_DRAFTS,
        },
      },
    )

  describe('addToHistory', () => {
    it('appends to history array', () => {
      const { result } = renderInputHistory()

      act(() => {
        result.current.addToHistory('hello')
      })

      expect(result.current.inputHistory).toEqual(['hello'])
    })

    it('appends multiple items in order', () => {
      const { result } = renderInputHistory()

      act(() => {
        result.current.addToHistory('first')
      })
      act(() => {
        result.current.addToHistory('second')
      })

      expect(result.current.inputHistory).toEqual(['first', 'second'])
    })

    it('rejects empty strings', () => {
      const { result } = renderInputHistory()

      act(() => {
        result.current.addToHistory('')
      })

      expect(result.current.inputHistory).toEqual([])
    })

    it('rejects whitespace-only strings', () => {
      const { result } = renderInputHistory()

      act(() => {
        result.current.addToHistory('   ')
      })

      expect(result.current.inputHistory).toEqual([])
    })
  })

  describe('navigateUp', () => {
    it('shows previous message when cursor at start', () => {
      seedHistory(['old message'])

      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateUp()
      })

      expect(handled).toBe(true)
      expect(mockTextarea.value).toBe('old message')
    })

    it('places cursor at beginning after navigation', () => {
      seedHistory(['old message'])

      const { result } = renderInputHistory()

      act(() => {
        result.current.navigateUp()
      })

      expect(mockTextarea.selectionStart).toBe(0)
      expect(mockTextarea.selectionEnd).toBe(0)
    })

    it('does nothing when cursor not at start', () => {
      seedHistory(['old message'])
      mockTextarea.value = 'current'
      mockTextarea.selectionStart = 3
      mockTextarea.selectionEnd = 3

      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateUp()
      })

      expect(handled).toBe(false)
      expect(mockTextarea.value).toBe('current')
    })

    it('returns false when history is empty and stack is empty', () => {
      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateUp()
      })

      expect(handled).toBe(false)
    })

    it('returns false when textarea is null', () => {
      seedHistory(['old'])
      textareaRef.current = null

      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateUp()
      })

      expect(handled).toBe(false)
    })

    it('calls resizeTextarea after navigation', () => {
      seedHistory(['old'])

      const { result } = renderInputHistory()

      act(() => {
        result.current.navigateUp()
      })

      expect(resizeTextarea).toHaveBeenCalled()
    })

    it('navigates backward through history', () => {
      seedHistory(['first', 'second', 'third'])

      const { result } = renderInputHistory()

      // First Up goes to newest (third)
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('third')

      // Cursor should already be at start after navigateUp
      // Second Up goes to second
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('second')

      // Third Up goes to first
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('first')
    })

    it('stays at oldest on repeated Up', () => {
      seedHistory(['only'])

      const { result } = renderInputHistory()

      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('only')

      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('only')
    })

    it('shows draft stack items non-destructively before entering history', () => {
      seedHistory(['history item'])
      const drafts = { current: '', stack: ['draft1', 'draft2'] }

      const { result } = renderInputHistory({ drafts })

      // First Up shows newest draft (non-destructive - no saveDrafts call)
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('draft2')
      expect(saveDrafts).not.toHaveBeenCalled() // Non-destructive
    })
  })

  describe('navigateDown', () => {
    it('pushes to stack and clears when input is non-empty', () => {
      mockTextarea.value = 'my typing'
      mockTextarea.selectionStart = 9 // cursor at end
      mockTextarea.selectionEnd = 9

      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateDown()
      })

      expect(handled).toBe(true)
      expect(mockTextarea.value).toBe('')
      expect(saveDrafts).toHaveBeenCalledWith({ current: '', stack: ['my typing'] })
    })

    it('does nothing when input is empty and not navigating', () => {
      mockTextarea.value = ''
      mockTextarea.selectionStart = 0
      mockTextarea.selectionEnd = 0

      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateDown()
      })

      expect(handled).toBe(false)
    })

    it('does nothing when cursor not at end', () => {
      mockTextarea.value = 'test'
      mockTextarea.selectionStart = 2 // cursor in middle
      mockTextarea.selectionEnd = 2

      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateDown()
      })

      expect(handled).toBe(false)
      expect(saveDrafts).not.toHaveBeenCalled()
    })

    it('moves to newer message when in history', () => {
      seedHistory(['old', 'new'])

      const { result } = renderInputHistory()

      // Navigate up twice to get to 'old'
      act(() => {
        result.current.navigateUp()
      })
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('old')

      // Set cursor at end for Down navigation
      mockTextarea.selectionStart = mockTextarea.value.length

      // Navigate down to 'new'
      let handled
      act(() => {
        handled = result.current.navigateDown()
      })

      expect(handled).toBe(true)
      expect(mockTextarea.value).toBe('new')
    })

    it('places cursor at end after navigation', () => {
      seedHistory(['old', 'new'])

      const { result } = renderInputHistory()

      // Navigate up twice to get to 'old'
      act(() => {
        result.current.navigateUp()
      })
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('old')

      // Set cursor at end for Down navigation
      mockTextarea.selectionStart = mockTextarea.value.length

      // Navigate down to 'new'
      act(() => {
        result.current.navigateDown()
      })

      expect(mockTextarea.selectionStart).toBe(3) // 'new'.length
      expect(mockTextarea.selectionEnd).toBe(3)
    })

    it('returns to empty when past newest history', () => {
      seedHistory(['old'])

      const { result } = renderInputHistory()

      // Navigate up to history
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('old')

      // Set cursor at end
      mockTextarea.selectionStart = mockTextarea.value.length

      // Navigate down past newest returns to empty
      act(() => {
        result.current.navigateDown()
      })

      expect(mockTextarea.value).toBe('')
    })

    it('calls resizeTextarea after navigation', () => {
      seedHistory(['old', 'new'])

      const { result } = renderInputHistory()

      // Get into history
      act(() => {
        result.current.navigateUp()
      })
      resizeTextarea.mockClear()

      mockTextarea.selectionStart = mockTextarea.value.length

      act(() => {
        result.current.navigateDown()
      })

      expect(resizeTextarea).toHaveBeenCalled()
    })
  })

  describe('draft stack behavior', () => {
    it('follows LIFO order for draft stack push', () => {
      const { result } = renderInputHistory()

      // Type "first" and press Down - pushes to stack
      mockTextarea.value = 'first'
      mockTextarea.selectionStart = 5
      act(() => {
        result.current.navigateDown()
      })
      expect(mockTextarea.value).toBe('')
      expect(saveDrafts).toHaveBeenCalledWith({ current: '', stack: ['first'] })

      // Type "second" and press Down - pushes to stack
      mockTextarea.value = 'second'
      mockTextarea.selectionStart = 6
      const drafts = { current: '', stack: ['first'] }
      const { result: result2 } = renderInputHistory({ drafts })
      act(() => {
        result2.current.navigateDown()
      })
      expect(saveDrafts).toHaveBeenLastCalledWith({ current: '', stack: ['first', 'second'] })
    })

    it('navigates drafts non-destructively with Up (LIFO order)', () => {
      const drafts = { current: '', stack: ['first', 'second'] }
      const { result } = renderInputHistory({ drafts })

      // First Up shows 'second' (newest) - non-destructive
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('second')
      expect(saveDrafts).not.toHaveBeenCalled()

      // Second Up shows 'first' (older) - non-destructive
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('first')
      expect(saveDrafts).not.toHaveBeenCalled()
    })

    it('navigates back through drafts with Down', () => {
      seedHistory(['history'])
      const drafts = { current: '', stack: ['draft1', 'draft2'] }
      const { result } = renderInputHistory({ drafts })

      // Navigate up through drafts and into history
      act(() => {
        result.current.navigateUp() // draft2
      })
      act(() => {
        result.current.navigateUp() // draft1
      })
      act(() => {
        result.current.navigateUp() // history
      })
      expect(mockTextarea.value).toBe('history')

      // Set cursor at end for Down navigation
      mockTextarea.selectionStart = mockTextarea.value.length

      // Navigate down back through drafts
      act(() => {
        result.current.navigateDown() // back to draft1
      })
      expect(mockTextarea.value).toBe('draft1')

      mockTextarea.selectionStart = mockTextarea.value.length
      act(() => {
        result.current.navigateDown() // back to draft2
      })
      expect(mockTextarea.value).toBe('draft2')

      mockTextarea.selectionStart = mockTextarea.value.length
      act(() => {
        result.current.navigateDown() // back to fresh
      })
      expect(mockTextarea.value).toBe('')
    })
  })

  describe('resetIndex', () => {
    it('resets navigation state so Down pushes to stack instead of navigating', () => {
      seedHistory(['old'])

      const { result } = renderInputHistory()

      // Navigate into history
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('old')

      // Reset
      act(() => {
        result.current.resetIndex()
      })

      // Now Down with non-empty input should push to stack
      mockTextarea.value = 'new content'
      mockTextarea.selectionStart = 11
      act(() => {
        result.current.navigateDown()
      })

      expect(saveDrafts).toHaveBeenCalledWith({ current: '', stack: ['new content'] })
    })
  })

  describe('edge cases', () => {
    it('handles null sessionId without persistence', () => {
      const { result } = renderInputHistory({ sessionId: null })

      act(() => {
        result.current.addToHistory('no persist')
      })

      // Still queued in recentAdditionsRef even without sessionId
      // Navigation should work
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('no persist')
    })

    it('includes recently added items before state update', () => {
      const { result } = renderInputHistory()

      // Add item - goes to recentAdditionsRef immediately
      act(() => {
        result.current.addToHistory('just added')
      })

      // Navigate should find it even though state might not be updated yet
      // (because recentAdditionsRef is used in effectiveHistory)
      act(() => {
        result.current.navigateUp()
      })

      expect(mockTextarea.value).toBe('just added')
    })

    it('does nothing when cursor has selection not at start', () => {
      seedHistory(['old message'])
      mockTextarea.value = 'current'
      mockTextarea.selectionStart = 0
      mockTextarea.selectionEnd = 3 // Has selection

      const { result } = renderInputHistory()

      let handled
      act(() => {
        handled = result.current.navigateUp()
      })

      expect(handled).toBe(false)
    })
  })

  describe('getNavState', () => {
    it('returns null source when fresh', () => {
      const { result } = renderInputHistory()

      const state = result.current.getNavState()
      expect(state.source).toBe(null)
    })

    it('returns draft source when viewing draft', () => {
      const drafts = { current: '', stack: ['draft1'] }
      const { result } = renderInputHistory({ drafts })

      act(() => {
        result.current.navigateUp()
      })

      const state = result.current.getNavState()
      expect(state.source).toBe('draft')
      expect(state.index).toBe(0)
    })

    it('returns history source when viewing history', () => {
      seedHistory(['history1'])
      const { result } = renderInputHistory()

      act(() => {
        result.current.navigateUp()
      })

      const state = result.current.getNavState()
      expect(state.source).toBe('history')
      expect(state.index).toBe(0)
    })
  })

  describe('updateCurrentItem', () => {
    it('updates draft item in-place', () => {
      const drafts = { current: '', stack: ['original'] }
      const { result } = renderInputHistory({ drafts })

      // Navigate to draft
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('original')

      // Update in place
      act(() => {
        result.current.updateCurrentItem('modified')
      })

      expect(saveDrafts).toHaveBeenCalledWith({ current: '', stack: ['modified'] })
    })

    it('updates history item in-place', () => {
      seedHistory(['original'])
      const { result } = renderInputHistory()

      // Navigate to history
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('original')

      // Update in place
      act(() => {
        result.current.updateCurrentItem('modified')
      })

      expect(result.current.inputHistory).toEqual(['modified'])
    })

    it('does nothing when in fresh state', () => {
      seedHistory(['history'])
      const drafts = { current: '', stack: ['draft'] }
      const { result } = renderInputHistory({ drafts })

      // Stay in fresh state
      act(() => {
        result.current.updateCurrentItem('should not save')
      })

      expect(saveDrafts).not.toHaveBeenCalled()
      expect(result.current.inputHistory).toEqual(['history']) // Unchanged
    })
  })

  describe('prepareSubmit', () => {
    it('removes draft from stack when submitting from draft', () => {
      const drafts = { current: '', stack: ['draft1', 'draft2'] }
      const { result } = renderInputHistory({ drafts })

      // Navigate to newest draft
      act(() => {
        result.current.navigateUp()
      })
      expect(mockTextarea.value).toBe('draft2')

      // Submit
      let submitResult
      act(() => {
        submitResult = result.current.prepareSubmit('draft2')
      })

      expect(submitResult.fromDraft).toBe(true)
      expect(submitResult.content).toBe('draft2')
      // Should remove draft2 (index 0 = newest), keep draft1
      expect(saveDrafts).toHaveBeenCalledWith({ current: '', stack: ['draft1'] })
      // Should add to history
      expect(result.current.inputHistory).toEqual(['draft2'])
    })

    it('keeps draft stack when submitting from history', () => {
      seedHistory(['history1'])
      const drafts = { current: '', stack: ['draft1'] }
      const { result } = renderInputHistory({ drafts })

      // Navigate past drafts into history
      act(() => {
        result.current.navigateUp() // draft1
      })
      act(() => {
        result.current.navigateUp() // history1
      })
      expect(mockTextarea.value).toBe('history1')

      // Submit (re-send from history)
      act(() => {
        result.current.prepareSubmit('history1')
      })

      // Draft stack should be preserved
      expect(saveDrafts).toHaveBeenCalledWith({ current: '', stack: ['draft1'] })
      // Should add new entry to history
      expect(result.current.inputHistory).toEqual(['history1', 'history1'])
    })

    it('keeps draft stack when submitting fresh text', () => {
      const drafts = { current: '', stack: ['parked'] }
      const { result } = renderInputHistory({ drafts })

      // Submit fresh text (nav state is null)
      act(() => {
        result.current.prepareSubmit('new message')
      })

      // Draft stack should be preserved
      expect(saveDrafts).toHaveBeenCalledWith({ current: '', stack: ['parked'] })
      // Should add to history
      expect(result.current.inputHistory).toEqual(['new message'])
    })

    it('resets navigation state after submit', () => {
      seedHistory(['history1'])
      const { result } = renderInputHistory()

      // Navigate to history
      act(() => {
        result.current.navigateUp()
      })
      expect(result.current.getNavState().source).toBe('history')

      // Submit
      act(() => {
        result.current.prepareSubmit('history1')
      })

      // Should be back to fresh state
      expect(result.current.getNavState().source).toBe(null)
    })
  })

  describe('fallback bootstrap from eventsRef', () => {
    it('initializes history from events when localStorage is empty', () => {
      const eventsRef = {
        current: [
          { type: 'user', is_human: true, content: 'hello' },
          { type: 'assistant', content: 'hi there' },
          { type: 'user', is_human: true, content: 'how are you' },
        ],
      }

      const { result } = renderInputHistory({ eventsRef })

      expect(result.current.inputHistory).toEqual(['hello', 'how are you'])
    })

    it('does not override existing localStorage history', () => {
      seedHistory(['existing'])
      const eventsRef = {
        current: [{ type: 'user', is_human: true, content: 'from events' }],
      }

      const { result } = renderInputHistory({ eventsRef })

      expect(result.current.inputHistory).toEqual(['existing'])
    })

    it('handles empty eventsRef gracefully', () => {
      const eventsRef = { current: [] }

      const { result } = renderInputHistory({ eventsRef })

      expect(result.current.inputHistory).toEqual([])
    })

    it('handles null eventsRef gracefully', () => {
      const { result } = renderInputHistory({ eventsRef: null })

      expect(result.current.inputHistory).toEqual([])
    })

    it('bootstraps when events arrive after initial mount (delayed SSE replay)', () => {
      const eventsRef = { current: [] }

      // Mount with empty events (simulates mount before SSE replay completes)
      const { result, rerender } = renderInputHistory({ eventsRef, eventsLength: 0 })
      expect(result.current.inputHistory).toEqual([])

      // Simulate SSE replay delivering events
      eventsRef.current = [
        { type: 'user', is_human: true, content: 'first message' },
        { type: 'assistant', content: 'response' },
        { type: 'user', is_human: true, content: 'second message' },
      ]

      // Re-render with updated eventsLength to trigger bootstrap
      act(() => {
        rerender({
          sessionId: 'test-session',
          eventsRef,
          eventsLength: 3,
          drafts: DEFAULT_DRAFTS,
        })
      })

      expect(result.current.inputHistory).toEqual(['first message', 'second message'])
    })
  })
})
