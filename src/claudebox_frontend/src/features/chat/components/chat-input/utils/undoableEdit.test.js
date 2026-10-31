/** Tests for applyUndoableEdit: the changed span it hands the browser, and its fallback. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUndoableEdit } from './undoableEdit'

function textareaWith(value) {
  const ta = document.createElement('textarea')
  ta.value = value
  document.body.appendChild(ta)
  return ta
}

afterEach(() => {
  document.body.innerHTML = ''
  delete document.execCommand
})

describe('applyUndoableEdit', () => {
  it('hands the browser only the span that changed', () => {
    const calls = []
    document.execCommand = vi.fn((command, _ui, text) => {
      const ta = document.querySelector('textarea')
      calls.push({ command, text, range: [ta.selectionStart, ta.selectionEnd] })
      return false
    })
    const ta = textareaWith('fix the bug')

    applyUndoableEdit(ta, { value: 'fix <this>the</this> bug' })

    expect(calls).toEqual([{ command: 'insertText', text: '<this>the</this>', range: [4, 7] }])
  })

  it('replaces the whole selection when the result only replaces the selection', () => {
    const calls = []
    document.execCommand = vi.fn((command, _ui, text) => {
      const ta = document.querySelector('textarea')
      calls.push({ command, text, range: [ta.selectionStart, ta.selectionEnd] })
      return false
    })
    const ta = textareaWith('x <b> y')
    ta.setSelectionRange(2, 5)

    applyUndoableEdit(ta, { value: 'x <this><b></this> y' })

    expect(calls).toEqual([{ command: 'insertText', text: '<this><b></this>', range: [2, 5] }])
  })

  it('deletes a removed span rather than inserting nothing', () => {
    const commands = []
    document.execCommand = vi.fn(command => {
      commands.push(command)
      return false
    })
    const ta = textareaWith('  a')

    applyUndoableEdit(ta, { value: 'a' })

    expect(commands).toEqual(['delete'])
  })

  it('assigns the value and fires input when no browser edit applies', () => {
    const ta = textareaWith('- one')
    const onInput = vi.fn()
    ta.addEventListener('input', onInput)

    applyUndoableEdit(ta, { value: '- one\n- ', selStart: 8, selEnd: 8 })

    expect(ta.value).toBe('- one\n- ')
    expect(onInput).toHaveBeenCalledTimes(1)
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([8, 8])
  })

  it('only moves the selection when the value is unchanged', () => {
    document.execCommand = vi.fn()
    const ta = textareaWith('same')

    applyUndoableEdit(ta, { value: 'same', selStart: 1, selEnd: 3 })

    expect(document.execCommand).not.toHaveBeenCalled()
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([1, 3])
  })
})
