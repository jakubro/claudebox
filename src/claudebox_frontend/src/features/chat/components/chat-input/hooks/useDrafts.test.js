/** Tests for useDrafts hook. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useDrafts from './useDrafts'

describe('useDrafts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  /**
   * Create mock textarea element.
   */
  function createMockTextarea(value = '') {
    return { value }
  }

  it('returns default drafts when no stored value', () => {
    const textareaRef = { current: createMockTextarea() }
    const resizeTextarea = vi.fn()

    const { result } = renderHook(() => useDrafts('session-1', textareaRef, resizeTextarea))

    expect(result.current.drafts).toEqual({ current: '', stack: [] })
  })

  it('loads drafts from localStorage', () => {
    localStorage.setItem(
      'draft:session-1',
      JSON.stringify({ current: 'saved draft', stack: ['old draft'] }),
    )
    const textareaRef = { current: createMockTextarea() }
    const resizeTextarea = vi.fn()

    const { result } = renderHook(() => useDrafts('session-1', textareaRef, resizeTextarea))

    expect(result.current.drafts.current).toBe('saved draft')
    expect(result.current.drafts.stack).toEqual(['old draft'])
  })

  it('saveDrafts() updates state', () => {
    const textareaRef = { current: createMockTextarea() }
    const resizeTextarea = vi.fn()

    const { result } = renderHook(() => useDrafts('session-1', textareaRef, resizeTextarea))

    act(() => {
      result.current.saveDrafts({ current: 'new draft', stack: [] })
    })

    expect(result.current.drafts.current).toBe('new draft')
  })

  it('restores draft to empty textarea on session change', () => {
    localStorage.setItem(
      'draft:session-2',
      JSON.stringify({ current: 'session 2 draft', stack: [] }),
    )
    const textarea = createMockTextarea('')
    const textareaRef = { current: textarea }
    const resizeTextarea = vi.fn()

    const { rerender } = renderHook(
      ({ sessionId }) => useDrafts(sessionId, textareaRef, resizeTextarea),
      { initialProps: { sessionId: 'session-1' } },
    )

    // Switch to session-2
    rerender({ sessionId: 'session-2' })

    expect(textarea.value).toBe('session 2 draft')
    expect(resizeTextarea).toHaveBeenCalled()
  })

  it('returns userHasTypedRef', () => {
    const textareaRef = { current: createMockTextarea() }
    const resizeTextarea = vi.fn()

    const { result } = renderHook(() => useDrafts('session-1', textareaRef, resizeTextarea))

    expect(result.current.userHasTypedRef).toBeDefined()
    expect(result.current.userHasTypedRef.current).toBe(false)
  })

  it('skips restore when userHasTypedRef is true even if textarea is empty', () => {
    localStorage.setItem(
      'draft:session-2',
      JSON.stringify({ current: 'session 2 draft', stack: [] }),
    )
    const textarea = createMockTextarea('')
    const textareaRef = { current: textarea }
    const resizeTextarea = vi.fn()

    const { result, rerender } = renderHook(
      ({ sessionId }) => useDrafts(sessionId, textareaRef, resizeTextarea),
      { initialProps: { sessionId: 'session-1' } },
    )

    // Simulate user typing (sets flag without changing textarea value for the race scenario)
    result.current.userHasTypedRef.current = true
    textarea.value = ''

    // Switch to session-2 - should NOT restore because session switch resets the flag
    rerender({ sessionId: 'session-2' })

    // Session switch resets userHasTypedRef, so draft IS restored
    expect(textarea.value).toBe('session 2 draft')
  })

  it('skips restore on async draft load when userHasTypedRef is true', () => {
    const textarea = createMockTextarea('')
    const textareaRef = { current: textarea }
    const resizeTextarea = vi.fn()

    const { result, rerender } = renderHook(() =>
      useDrafts('session-1', textareaRef, resizeTextarea),
    )

    // Simulate user typing after initial render
    result.current.userHasTypedRef.current = true

    // Simulate async draft load (e.g., from another tab or delayed localStorage)
    act(() => {
      result.current.saveDrafts({ current: 'late draft', stack: [] })
    })
    rerender()

    // Should NOT overwrite - user has typed
    expect(textarea.value).toBe('')
  })

  it('clears old session text and restores new draft on session switch', () => {
    localStorage.setItem(
      'draft:session-2',
      JSON.stringify({ current: 'session 2 draft', stack: [] }),
    )
    const textarea = createMockTextarea('old session text')
    const textareaRef = { current: textarea }
    const resizeTextarea = vi.fn()

    const { rerender } = renderHook(
      ({ sessionId }) => useDrafts(sessionId, textareaRef, resizeTextarea),
      { initialProps: { sessionId: 'session-1' } },
    )

    // Switch to session-2 - old text cleared, new draft restored
    rerender({ sessionId: 'session-2' })

    expect(textarea.value).toBe('session 2 draft')
  })

  it('restores draft when draft loads after initial render', () => {
    const textarea = createMockTextarea('')
    const textareaRef = { current: textarea }
    const resizeTextarea = vi.fn()

    // Start with empty localStorage
    const { result, rerender } = renderHook(() =>
      useDrafts('session-1', textareaRef, resizeTextarea),
    )

    // Simulate draft being saved
    act(() => {
      result.current.saveDrafts({ current: 'loaded draft', stack: [] })
    })

    // Force re-render to trigger draft restoration
    rerender()

    expect(textarea.value).toBe('loaded draft')
  })

  it('handles null sessionId (no persistence)', () => {
    const textareaRef = { current: createMockTextarea() }
    const resizeTextarea = vi.fn()

    const { result } = renderHook(() => useDrafts(null, textareaRef, resizeTextarea))

    expect(result.current.drafts).toEqual({ current: '', stack: [] })

    act(() => {
      result.current.saveDrafts({ current: 'test', stack: [] })
    })

    // Should still update state
    expect(result.current.drafts.current).toBe('test')
    // But not persist to localStorage
    expect(localStorage.length).toBe(0)
  })

  it('adds beforeunload listener for flushDrafts', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const textareaRef = { current: createMockTextarea() }
    const resizeTextarea = vi.fn()

    renderHook(() => useDrafts('session-1', textareaRef, resizeTextarea))

    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })

  it('removes beforeunload listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const textareaRef = { current: createMockTextarea() }
    const resizeTextarea = vi.fn()

    const { unmount } = renderHook(() => useDrafts('session-1', textareaRef, resizeTextarea))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })

  it('clears textarea on switch to session with no draft', () => {
    const textarea = createMockTextarea('old text')
    const textareaRef = { current: textarea }
    const resizeTextarea = vi.fn()

    const { rerender } = renderHook(
      ({ sessionId }) => useDrafts(sessionId, textareaRef, resizeTextarea),
      { initialProps: { sessionId: 'session-1' } },
    )

    // Switch to session-2 which has no stored draft
    rerender({ sessionId: 'session-2' })

    expect(textarea.value).toBe('')
  })

  it('restores original draft when switching back', () => {
    localStorage.setItem('draft:session-1', JSON.stringify({ current: 'draft A', stack: [] }))
    localStorage.setItem('draft:session-2', JSON.stringify({ current: 'draft B', stack: [] }))
    const textarea = createMockTextarea('')
    const textareaRef = { current: textarea }
    const resizeTextarea = vi.fn()

    const { rerender } = renderHook(
      ({ sessionId }) => useDrafts(sessionId, textareaRef, resizeTextarea),
      { initialProps: { sessionId: 'session-1' } },
    )

    expect(textarea.value).toBe('draft A')

    // Switch to session-2
    rerender({ sessionId: 'session-2' })
    expect(textarea.value).toBe('draft B')

    // Switch back to session-1
    rerender({ sessionId: 'session-1' })
    expect(textarea.value).toBe('draft A')
  })

  it('handles null textarea gracefully', () => {
    localStorage.setItem('draft:session-1', JSON.stringify({ current: 'saved draft', stack: [] }))
    const textareaRef = { current: null }
    const resizeTextarea = vi.fn()

    // Should not throw
    expect(() => {
      renderHook(() => useDrafts('session-1', textareaRef, resizeTextarea))
    }).not.toThrow()
  })
})
