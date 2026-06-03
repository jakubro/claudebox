/** Tests for useBlockCollapse hook. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useBlockCollapse from './useBlockCollapse'

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

describe('collapseLocal', () => {
  it('collapses the innermost block at cursor', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<div>hello</div>', 7)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('<div...1>')
    expect(resize).toHaveBeenCalledTimes(1)
  })

  it('collapses inner block when nested', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<outer><inner>text</inner></outer>', 15)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('<outer><inner...1></outer>')
  })

  it('does nothing when cursor is outside any block', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('no blocks here', 5)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('no blocks here')
    expect(resize).not.toHaveBeenCalled()
  })

  it('collapses outer block after inner is already collapsed', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    // First collapse inner
    const textarea = createTextarea('<outer><inner>text</inner></outer>', 15)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<outer><inner...1></outer>')

    // Now cursor is inside outer, collapse outer
    textarea.selectionStart = textarea.selectionEnd = 3
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<outer...2>')
  })
})

describe('collapseAll', () => {
  it('collapses all blocks', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<foo>bar</foo> <baz>qux</baz>', 0)
    result.current.collapseAll(textarea)

    expect(textarea.value).toBe('<foo...1> <baz...2>')
    expect(resize).toHaveBeenCalledTimes(1)
  })

  it('does nothing with no blocks', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('plain text', 0)
    result.current.collapseAll(textarea)

    expect(textarea.value).toBe('plain text')
  })
})

describe('expandLocal', () => {
  it('expands the collapsed block at cursor', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    // Collapse first
    const textarea = createTextarea('<div>hello</div>', 7)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<div...1>')

    // Place cursor inside collapsed placeholder and expand
    textarea.selectionStart = textarea.selectionEnd = 3
    result.current.expandLocal(textarea)

    expect(textarea.value).toBe('<div>hello</div>')
    expect(resize).toHaveBeenCalledTimes(2)
  })

  it('does nothing when cursor is not on a collapsed block', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('no collapsed blocks', 5)
    result.current.expandLocal(textarea)

    expect(textarea.value).toBe('no collapsed blocks')
    expect(resize).not.toHaveBeenCalled()
  })
})

describe('expandAll', () => {
  it('expands all collapsed blocks', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<foo>bar</foo> <baz>qux</baz>', 0)
    result.current.collapseAll(textarea)
    expect(textarea.value).toBe('<foo...1> <baz...2>')

    result.current.expandAll(textarea)
    expect(textarea.value).toBe('<foo>bar</foo> <baz>qux</baz>')
  })
})

describe('expandBeforeSubmit', () => {
  it('expands all collapsed blocks without resizing', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<div>content</div>', 7)
    result.current.collapseLocal(textarea)
    expect(textarea.value).toBe('<div...1>')

    resize.mockClear()
    result.current.expandBeforeSubmit(textarea)

    expect(textarea.value).toBe('<div>content</div>')
    expect(resize).not.toHaveBeenCalled()
  })

  it('does nothing when no blocks are collapsed', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<div>content</div>', 7)
    result.current.expandBeforeSubmit(textarea)

    expect(textarea.value).toBe('<div>content</div>')
  })
})

describe('resetCollapse', () => {
  it('clears stored collapsed blocks', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

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
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<code>\nline1\nline2\n</code>', 10)
    result.current.collapseLocal(textarea)

    expect(textarea.value).toBe('<code...1>')
  })

  it('restores multiline content on expand', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

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
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<this>"<this>asdasd</this></this>', 10)
    result.current.collapseAll(textarea)

    // Inner collapses first (id=1), then outer wrapping inner placeholder (id=2)
    expect(textarea.value).toBe('<this...2>')

    result.current.expandAll(textarea)
    expect(textarea.value).toBe('<this>"<this>asdasd</this></this>')
  })

  it('correctly collapses and expands same-name siblings', () => {
    const resize = vi.fn()
    const { result } = renderHook(() => useBlockCollapse(resize))

    const textarea = createTextarea('<this>a</this> <this>b</this>', 0)
    result.current.collapseAll(textarea)

    expect(textarea.value).toBe('<this...1> <this...2>')

    result.current.expandAll(textarea)
    expect(textarea.value).toBe('<this>a</this> <this>b</this>')
  })
})
