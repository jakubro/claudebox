/** Tests for useAutoPair hook. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useAutoPair from './useAutoPair'

/**
 * Create a mock textarea with value and cursor position.
 */
function createTextarea(value, cursorPos) {
  return {
    value,
    selectionStart: cursorPos,
    selectionEnd: cursorPos,
  }
}

/**
 * Create a mock textarea with value and a text selection range.
 */
function createTextareaWithSelection(value, selStart, selEnd) {
  return {
    value,
    selectionStart: selStart,
    selectionEnd: selEnd,
  }
}

/**
 * Create a mock keydown event.
 */
function createKeyEvent(key) {
  let prevented = false
  return {
    key,
    preventDefault: () => {
      prevented = true
    },
    get defaultPrevented() {
      return prevented
    },
  }
}

describe('wrapSelection', () => {
  it('wraps selection with single quotes', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('hello world', 6, 11)
    const event = createKeyEvent("'")
    const handled = result.current.wrapSelection(textarea, event)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(textarea.value).toBe("hello 'world'")
    expect(textarea.selectionStart).toBe(13)
    expect(resizeTextarea).toHaveBeenCalledTimes(1)
  })

  it('wraps selection with double quotes', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('hello world', 6, 11)
    const event = createKeyEvent('"')
    result.current.wrapSelection(textarea, event)

    expect(textarea.value).toBe('hello "world"')
  })

  it('wraps selection with backticks', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('some code here', 5, 9)
    const event = createKeyEvent('`')
    result.current.wrapSelection(textarea, event)

    expect(textarea.value).toBe('some `code` here')
  })

  it('wraps selection with parentheses', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('value', 0, 5)
    const event = createKeyEvent('(')
    result.current.wrapSelection(textarea, event)

    expect(textarea.value).toBe('(value)')
  })

  it('wraps selection with square brackets', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('item', 0, 4)
    const event = createKeyEvent('[')
    result.current.wrapSelection(textarea, event)

    expect(textarea.value).toBe('[item]')
  })

  it('wraps selection with curly braces', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('obj', 0, 3)
    const event = createKeyEvent('{')
    result.current.wrapSelection(textarea, event)

    expect(textarea.value).toBe('{obj}')
  })

  it('returns false without selection', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextarea('hello', 3)
    const event = createKeyEvent("'")
    const handled = result.current.wrapSelection(textarea, event)

    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(textarea.value).toBe('hello')
    expect(resizeTextarea).not.toHaveBeenCalled()
  })

  it('returns false for non-wrap characters', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('hello world', 6, 11)
    const event = createKeyEvent('a')
    const handled = result.current.wrapSelection(textarea, event)

    expect(handled).toBe(false)
    expect(textarea.value).toBe('hello world')
  })

  it('positions cursor after closing character', () => {
    const resizeTextarea = vi.fn()
    const { result } = renderHook(() => useAutoPair(resizeTextarea))

    const textarea = createTextareaWithSelection('abc', 1, 2)
    const event = createKeyEvent('(')
    result.current.wrapSelection(textarea, event)

    expect(textarea.value).toBe('a(b)c')
    // Cursor after ')': position 4 (original selectionEnd=2 + 2)
    expect(textarea.selectionStart).toBe(4)
    expect(textarea.selectionEnd).toBe(4)
  })
})
