/** Tests for useChatKeyboard hook — keyboard shortcut dispatch. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useChatKeyboard from './useChatKeyboard'

vi.mock('../../../../../api/chat', () => ({
  interrupt: vi.fn(),
}))

/** Build a stub params object with a real textarea attached to the document. */
function setup() {
  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  textarea.focus()

  const resizeTextarea = vi.fn()

  const params = {
    textareaRef: { current: textarea },
    peekInput: vi.fn(),
    commitInput: vi.fn(),
    extractInput: vi.fn(),
    send: vi.fn(),
    setSending: vi.fn(),
    enqueueMessage: vi.fn(),
    deferSend: vi.fn(),
    isCreating: false,
    canInterrupt: false,
    interruptStatus: 'idle',
    startInterrupt: vi.fn(),
    completeInterrupt: vi.fn(),
    setError: vi.fn(),
    stashPush: vi.fn(),
    stashPop: vi.fn(),
    clearPendingInsert: vi.fn(),
    saveDrafts: vi.fn(),
    resizeTextarea,
    navigateUp: vi.fn(() => false),
    navigateDown: vi.fn(() => false),
    collapseLocal: vi.fn(),
    collapseAll: vi.fn(),
    expandLocal: vi.fn(),
    expandAll: vi.fn(),
    wrapSelection: vi.fn(() => false),
    isMobile: false,
  }

  const cleanup = () => document.body.removeChild(textarea)
  return { textarea, params, resizeTextarea, cleanup }
}

/** Build a fake KeyboardEvent stub with preventDefault tracking. */
function keyEvent(
  key,
  { shiftKey = false, altKey = false, ctrlKey = false, metaKey = false } = {},
) {
  return {
    key,
    shiftKey,
    altKey,
    ctrlKey,
    metaKey,
    preventDefault: vi.fn(),
  }
}

/** Set textarea value and selection range. */
function setTextarea(textarea, value, selStart, selEnd = selStart) {
  textarea.value = value
  textarea.setSelectionRange(selStart, selEnd)
}

/** Read post-handler textarea state for assertions. */
function readState(textarea) {
  return {
    value: textarea.value,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    focused: document.activeElement === textarea,
  }
}

describe('useChatKeyboard — Tab/Shift+Tab', () => {
  it('Tab inserts 2 spaces at caret in content zone (no selection)', () => {
    const { textarea, params, resizeTextarea, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'hello world', 5)
    const e = keyEvent('Tab')
    result.current.handleKeyDown(e)

    expect(e.preventDefault).toHaveBeenCalled()
    // 2 spaces inserted at caret 5; original space at index 5 is preserved as part of " world".
    expect(readState(textarea)).toEqual({
      value: 'hello   world',
      start: 7,
      end: 7,
      focused: true,
    })
    expect(resizeTextarea).toHaveBeenCalled()
    cleanup()
  })

  it('Tab snaps from 0 leading whitespace to 2 (col 0)', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'hello', 0)
    result.current.handleKeyDown(keyEvent('Tab'))

    expect(readState(textarea)).toMatchObject({ value: '  hello', start: 2, end: 2 })
    cleanup()
  })

  it('Tab snaps from 1 leading to 2 (not 3)', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, ' hello', 0)
    result.current.handleKeyDown(keyEvent('Tab'))

    expect(readState(textarea)).toMatchObject({ value: '  hello', start: 2, end: 2 })
    cleanup()
  })

  it('Tab snaps from 2 to 4 with caret at boundary (col = leadingLen)', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '  hello', 2)
    result.current.handleKeyDown(keyEvent('Tab'))

    expect(readState(textarea)).toMatchObject({ value: '    hello', start: 4, end: 4 })
    cleanup()
  })

  it('Tab snaps from 4 to 6 with caret in leading zone (col 0)', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '    hello', 0)
    result.current.handleKeyDown(keyEvent('Tab'))

    expect(readState(textarea)).toMatchObject({ value: '      hello', start: 6, end: 6 })
    cleanup()
  })

  it('Tab replaces single-line selection in content zone with 2 spaces', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'hello world', 6, 11)
    result.current.handleKeyDown(keyEvent('Tab'))

    // "hello " (kept, indices 0-5) + "  " (replacing "world") = "hello   " (8 chars).
    expect(readState(textarea)).toMatchObject({ value: 'hello   ', start: 8, end: 8 })
    cleanup()
  })

  it('Tab indents two lines via multi-line selection', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'a\nb', 0, 3)
    result.current.handleKeyDown(keyEvent('Tab'))

    expect(readState(textarea)).toMatchObject({
      value: '  a\n  b',
      start: 0,
      end: 7,
    })
    cleanup()
  })

  it('Tab on empty multi-line selection (selection ends at \\n) operates only on first line', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'a\nb', 0, 2) // selects "a\n" only
    result.current.handleKeyDown(keyEvent('Tab'))

    // Only line 0 ('a') indents. Line 1 ('b') untouched.
    expect(textarea.value).toBe('  a\nb')
    cleanup()
  })

  it('Shift+Tab dedents 2 leading spaces to 0', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '  hello', 2)
    result.current.handleKeyDown(keyEvent('Tab', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: 'hello', start: 0, end: 0 })
    cleanup()
  })

  it('Shift+Tab dedents 3 leading spaces to 2', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '   hello', 3)
    result.current.handleKeyDown(keyEvent('Tab', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '  hello', start: 2, end: 2 })
    cleanup()
  })

  it('Shift+Tab dedents 1 leading space to 0', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, ' hello', 1)
    result.current.handleKeyDown(keyEvent('Tab', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: 'hello', start: 0, end: 0 })
    cleanup()
  })

  it('Shift+Tab is no-op on unindented line (preventDefault still called, value unchanged)', () => {
    const { textarea, params, resizeTextarea, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'hello', 0)
    const e = keyEvent('Tab', { shiftKey: true })
    result.current.handleKeyDown(e)

    expect(e.preventDefault).toHaveBeenCalled()
    expect(readState(textarea)).toMatchObject({ value: 'hello', start: 0, end: 0 })
    // No-op shouldn't fire input event or trigger resize.
    expect(resizeTextarea).not.toHaveBeenCalled()
    cleanup()
  })

  it('Shift+Tab dedents multi-line with mixed leading whitespace per line', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '  a\n    b\nc', 0, 11)
    result.current.handleKeyDown(keyEvent('Tab', { shiftKey: true }))

    // Line 0: 2→0 (-2). Line 1: 4→2 (-2). Line 2: 0 (no-op).
    expect(readState(textarea)).toMatchObject({
      value: 'a\n  b\nc',
      start: 0,
      end: 7,
    })
    cleanup()
  })

  it('Shift+Tab on single-line selection still snap-dedents the line', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    // Selection in content zone of a line that has 2 leading spaces.
    setTextarea(textarea, '  hello', 4, 7) // selects "llo"
    result.current.handleKeyDown(keyEvent('Tab', { shiftKey: true }))

    // Line dedents 2→0; selection shifts left by 2 chars.
    expect(readState(textarea)).toMatchObject({ value: 'hello', start: 2, end: 5 })
    cleanup()
  })

  it('Tab dispatches input event so drafts/autocomplete observers refresh', () => {
    const { textarea, params, cleanup } = setup()
    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'hello', 0)
    result.current.handleKeyDown(keyEvent('Tab'))

    expect(inputSpy).toHaveBeenCalled()
    cleanup()
  })
})

describe('useChatKeyboard — Shift+Enter smart newline', () => {
  // Layer 1: indent inheritance on prose lines.

  it('Shift+Enter on plain prose with no indent inserts plain newline', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'hello', 5)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: 'hello\n', start: 6, end: 6 })
    cleanup()
  })

  it('Shift+Enter end-of-line inherits 3-space indent', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '   hello', 8)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '   hello\n   ', start: 12, end: 12 })
    cleanup()
  })

  it('Shift+Enter mid-content split inherits indent on new line', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    // "   hello world" caret at 9 (between "hello " and "world")
    setTextarea(textarea, '   hello world', 9)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({
      value: '   hello \n   world',
      start: 13,
      end: 13,
    })
    cleanup()
  })

  // Layer 2: list-marker continuation.

  it('Shift+Enter continues dash bullet at end of line', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '- foo', 5)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '- foo\n- ', start: 8, end: 8 })
    cleanup()
  })

  it('Shift+Enter continues asterisk bullet', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '* foo', 5)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea).value).toBe('* foo\n* ')
    cleanup()
  })

  it('Shift+Enter continues plus bullet', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '+ foo', 5)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea).value).toBe('+ foo\n+ ')
    cleanup()
  })

  it('Shift+Enter auto-increments numbered list (dot)', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '1. foo', 6)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '1. foo\n2. ', start: 10, end: 10 })
    cleanup()
  })

  it('Shift+Enter auto-increments numbered list (paren)', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '1) foo', 6)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea).value).toBe('1) foo\n2) ')
    cleanup()
  })

  it('Shift+Enter auto-increments multi-digit numbered list', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '42. foo', 7)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea).value).toBe('42. foo\n43. ')
    cleanup()
  })

  it('Shift+Enter on unchecked task continues with empty checkbox', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '- [ ] foo', 9)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '- [ ] foo\n- [ ] ', start: 16, end: 16 })
    cleanup()
  })

  it('Shift+Enter on checked task ([x]) continues with always-unchecked checkbox', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '- [x] foo', 9)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    // [x] becomes [ ] on the new item — always-unchecked rule.
    expect(readState(textarea).value).toBe('- [x] foo\n- [ ] ')
    cleanup()
  })

  it('Shift+Enter on indented sub-bullet inherits indent + marker', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '  - sub', 7)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '  - sub\n  - ', start: 12, end: 12 })
    cleanup()
  })

  it('Shift+Enter mid-content list split inserts marker on new line', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    // "- foo bar" caret at 6 (between "foo " and "bar")
    setTextarea(textarea, '- foo bar', 6)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '- foo \n- bar', start: 9, end: 9 })
    cleanup()
  })

  // Empty-marker exit.

  it('Shift+Enter on empty bullet (- ) exits list, current line empty', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '- ', 2)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '\n', start: 1, end: 1 })
    cleanup()
  })

  it('Shift+Enter on empty numbered (1. ) exits list', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '1. ', 3)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea).value).toBe('\n')
    cleanup()
  })

  it('Shift+Enter on empty task (- [ ] ) exits list', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '- [ ] ', 6)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea).value).toBe('\n')
    cleanup()
  })

  it('Shift+Enter on empty indented bullet preserves indent on both lines', () => {
    const { textarea, params, cleanup } = setup()
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, '  - ', 4)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(readState(textarea)).toMatchObject({ value: '  \n  ', start: 5, end: 5 })
    cleanup()
  })

  // Key contract preservation — plain Enter still submits, doesn't continue list.

  it('plain Enter on list line falls through to submit branch (no list continuation)', () => {
    const { textarea, params, cleanup } = setup()
    const handleSubmitSpy = vi.fn()
    const { result } = renderHook(() => useChatKeyboard({ ...params, peekInput: handleSubmitSpy }))

    setTextarea(textarea, '- foo', 5)
    result.current.handleKeyDown(keyEvent('Enter'))

    // Submit handler ran (peekInput was called) and value did NOT gain "\n- ".
    expect(textarea.value).toBe('- foo')
    cleanup()
  })

  // Input event firing — drafts/autocomplete observers must refresh.

  it('Shift+Enter dispatches input event', () => {
    const { textarea, params, cleanup } = setup()
    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    const { result } = renderHook(() => useChatKeyboard(params))

    setTextarea(textarea, 'hello', 5)
    result.current.handleKeyDown(keyEvent('Enter', { shiftKey: true }))

    expect(inputSpy).toHaveBeenCalled()
    cleanup()
  })
})
