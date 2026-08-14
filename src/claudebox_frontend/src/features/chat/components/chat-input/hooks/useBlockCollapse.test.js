/** Tests for useBlockCollapse hook. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BlockCollapseManager from '../BlockCollapseManager'
import useBlockCollapse from './useBlockCollapse'

/** Create a real textarea attached to the document - dispatchEvent needs a live DOM node. */
function createTextarea(value, cursorPos) {
  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  textarea.value = value
  textarea.setSelectionRange(cursorPos, cursorPos)
  return textarea
}

// BlockCollapseManager's id counter is global - reset it so expected ids stay independent of test order.
beforeEach(() => {
  BlockCollapseManager.resetGlobalCounterForTests()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('collapseLocal', () => {
  it('collapses the innermost block at cursor', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<div>hello</div>', 7)
    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('<div...1>')
    expect(inputSpy).toHaveBeenCalledTimes(1)
  })

  it('collapses inner block when nested', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<outer><inner>text</inner></outer>', 15)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('<outer><inner...1></outer>')
  })

  it('does nothing when cursor is outside any block', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('no blocks here', 5)
    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('no blocks here')
    expect(inputSpy).not.toHaveBeenCalled()
  })

  it('collapses outer block after inner is already collapsed', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<outer><inner>text</inner></outer>', 15)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<outer><inner...1></outer>')

    textarea.selectionStart = textarea.selectionEnd = 3
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<outer...2>')
  })
})

describe('collapseAll', () => {
  it('collapses all blocks', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<foo>bar</foo> <baz>qux</baz>', 0)
    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    result.current.collapseAll(textarea)

    expect(textarea.value).toBe('<foo...1> <baz...2>')
    expect(inputSpy).toHaveBeenCalledTimes(1)
  })

  it('does nothing with no blocks', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('plain text', 0)
    result.current.collapseAll(textarea)

    expect(textarea.value).toBe('plain text')
  })
})

describe('expandLocal', () => {
  it('expands the collapsed block at cursor', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<div>hello</div>', 7)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<div...1>')

    textarea.selectionStart = textarea.selectionEnd = 3
    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    result.current.expandLocal(textarea)

    expect(textarea.value).toBe('<div>hello</div>')
    expect(inputSpy).toHaveBeenCalledTimes(1)
  })

  it('does nothing when cursor is not on a collapsed block', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('no collapsed blocks', 5)
    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    result.current.expandLocal(textarea)

    expect(textarea.value).toBe('no collapsed blocks')
    expect(inputSpy).not.toHaveBeenCalled()
  })
})

describe('expandAll', () => {
  it('expands all collapsed blocks', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<foo>bar</foo> <baz>qux</baz>', 0)
    result.current.collapseAll(textarea)
    expect(textarea.value).toBe('<foo...1> <baz...2>')

    result.current.expandAll(textarea)
    expect(textarea.value).toBe('<foo>bar</foo> <baz>qux</baz>')
  })
})

describe('expandBeforeSubmit', () => {
  it('expands all collapsed blocks without dispatching an input event', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<div>content</div>', 7)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<div...1>')

    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)
    result.current.expandBeforeSubmit(textarea)

    expect(textarea.value).toBe('<div>content</div>')
    expect(inputSpy).not.toHaveBeenCalled()
  })

  it('does nothing when no blocks are collapsed', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<div>content</div>', 7)
    result.current.expandBeforeSubmit(textarea)

    expect(textarea.value).toBe('<div>content</div>')
  })
})

describe('resetCollapse', () => {
  it('clears stored collapsed blocks', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<div>content</div>', 7)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<div...1>')

    result.current.resetCollapse()

    // expandAll should not restore anything after reset
    result.current.expandAll(textarea)
    expect(textarea.value).toBe('<div...1>')
  })
})

describe('multiline content', () => {
  it('collapses block with multiline content', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<code>\nline1\nline2\n</code>', 10)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('<code...1>')
  })

  it('restores multiline content on expand', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const original = '<code>\nline1\nline2\n</code>'
    const textarea = createTextarea(original, 10)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<code...1>')

    textarea.selectionStart = textarea.selectionEnd = 3
    result.current.expandLocal(textarea)
    expect(textarea.value).toBe(original)
  })
})

describe('same-name nested tags', () => {
  it('correctly collapses and expands same-name nested blocks', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<this>"<this>asdasd</this></this>', 10)
    result.current.collapseAll(textarea)

    // Inner collapses first (id=1), then outer wrapping inner placeholder (id=2)
    expect(textarea.value).toBe('<this...2>')

    result.current.expandAll(textarea)
    expect(textarea.value).toBe('<this>"<this>asdasd</this></this>')
  })

  it('correctly collapses and expands same-name siblings', () => {
    const { result } = renderHook(() => useBlockCollapse())

    const textarea = createTextarea('<this>a</this> <this>b</this>', 0)
    result.current.collapseAll(textarea)

    expect(textarea.value).toBe('<this...1> <this...2>')

    result.current.expandAll(textarea)
    expect(textarea.value).toBe('<this>a</this> <this>b</this>')
  })
})
