/** Tests for useAutocomplete hook — custom React autocomplete state. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockCapabilities } from '../../../../../test-utils/mockCapabilities'
import useAutocomplete from './useAutocomplete'

let mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }

vi.mock('../../../../../hooks/useCapabilities', () => ({
  default: () => mockUseCapabilities,
}))

beforeEach(() => {
  mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }
})

/** Dict-format commands matching API shape. */
const dictCommands = {
  custom: [
    { name: 'deploy', description: 'Deploy to production' },
    { name: 'test', usage: '/test [suite]', description: 'Run tests' },
  ],
  mcp: [{ name: 'mcp__slack__send' }],
  builtin: [{ name: 'compact' }],
}

describe('useAutocomplete', () => {
  function createTextareaRef() {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    return { current: textarea, cleanup: () => document.body.removeChild(textarea) }
  }

  it('returns autocomplete state', () => {
    const { current: textarea } = createTextareaRef()
    const textareaRef = { current: textarea }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    expect(result.current.visible).toBe(false)
    expect(result.current.items).toHaveLength(4)
    expect(result.current.selectedIndex).toBe(0)
  })

  it('shows autocomplete when / is typed at position 0', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      ref.current.value = '/'
      ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(result.current.visible).toBe(true)
    expect(result.current.items).toHaveLength(4)
    ref.cleanup()
  })

  it('filters items by typed text', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      ref.current.value = '/de'
      ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(result.current.visible).toBe(true)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].name).toBe('deploy')
    ref.cleanup()
  })

  it('activates when textarea starts with / followed by trailing arguments', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    // Simulate user typing '/' at position 0 of a non-empty textarea ('hello
    // world'). The resulting value is '/hello world' with cursor at 1 (just
    // after the inserted '/'). Picker must activate.
    act(() => {
      ref.current.value = '/hello world'
      ref.current.setSelectionRange(1, 1)
      ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(result.current.visible).toBe(true)
    expect(result.current.filter).toBe('')
    ref.cleanup()
  })

  it('filters by leading token when cursor sits inside it on a non-empty textarea', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    // Cursor at end of '/hello' (position 6) with trailing ' world'. Filter
    // reflects the leading-token prefix up to the cursor.
    act(() => {
      ref.current.value = '/hello world'
      ref.current.setSelectionRange(6, 6)
      ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(result.current.visible).toBe(true)
    expect(result.current.filter).toBe('hello')
    ref.cleanup()
  })

  it('hides when text does not start with /', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      ref.current.value = 'hello'
      ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(result.current.visible).toBe(false)
    ref.cleanup()
  })

  it('handles null commands gracefully', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    expect(() => {
      renderHook(() => useAutocomplete(textareaRef, null))
    }).not.toThrow()
    ref.cleanup()
  })

  it('handles null textarea gracefully', () => {
    const textareaRef = { current: null }

    expect(() => {
      renderHook(() => useAutocomplete(textareaRef, dictCommands))
    }).not.toThrow()
  })

  it('handleKeyDown returns false when not visible', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    const handled = result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} })
    expect(handled).toBe(false)
    ref.cleanup()
  })

  it('select inserts command into textarea', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      result.current.select({ name: 'deploy' })
    })

    expect(ref.current.value).toBe('/deploy ')
    expect(result.current.visible).toBe(false)
    ref.cleanup()
  })

  it('select places caret immediately after the inserted command and trailing space', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    ref.current.value = '/com'
    ref.current.setSelectionRange(4, 4)

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      result.current.select({ name: 'deploy' })
    })

    expect(ref.current.value).toBe('/deploy ')
    // 1 (slash) + 6 (deploy) + 1 (trailing space) = 8
    expect(ref.current.selectionStart).toBe(8)
    expect(ref.current.selectionEnd).toBe(8)
    ref.cleanup()
  })

  it('select preserves trailing args and places caret between space and args', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    ref.current.value = '/com some args'
    ref.current.setSelectionRange(4, 4)

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      result.current.select({ name: 'deploy' })
    })

    expect(ref.current.value).toBe('/deploy some args')
    // Caret lands between '/deploy ' and 'some args'
    expect(ref.current.selectionStart).toBe(8)
    ref.cleanup()
  })

  it('select on a leading slug without whitespace consumes the slug', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    ref.current.value = '/comX'
    ref.current.setSelectionRange(5, 5)

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      result.current.select({ name: 'deploy' })
    })

    expect(ref.current.value).toBe('/deploy ')
    expect(ref.current.selectionStart).toBe(8)
    ref.cleanup()
  })

  it('select preserves trailing text when command is typed in front without separating space', () => {
    // Reported regression: user types `/deploy` at position 0 of `foo bar baz`
    // → value becomes `/deployfoo bar baz`, caret at 7. Pressing Tab must
    // accept `/deploy` and preserve `foo bar baz` as the argument.
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    ref.current.value = '/deployfoo bar baz'
    ref.current.setSelectionRange(7, 7)

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      result.current.select({ name: 'deploy' })
    })

    expect(ref.current.value).toBe('/deploy foo bar baz')
    expect(ref.current.selectionStart).toBe(8)
    ref.cleanup()
  })

  it('select with already-spaced inline command preserves single space between command and args', () => {
    // User types `/deploy ` (with trailing space) in front of `foo bar baz`
    // and presses Tab with the caret still inside `/deploy`. Result: same
    // value, caret immediately after the space.
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    ref.current.value = '/deploy foo bar baz'
    ref.current.setSelectionRange(7, 7)

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      result.current.select({ name: 'deploy' })
    })

    expect(ref.current.value).toBe('/deploy foo bar baz')
    expect(ref.current.selectionStart).toBe(8)
    ref.cleanup()
  })

  it('select with picked variant mid-token preserves text after caret as arg', () => {
    // User types `/deploy`, moves caret to position 3 (between `/de` and
    // `ploy`), then picks `test`. Since `test` does NOT start with `deploy`,
    // the typed-but-after-caret portion is treated as user text and kept
    // as the argument.
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    ref.current.value = '/deploy'
    ref.current.setSelectionRange(3, 3)

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      result.current.select({ name: 'test' })
    })

    expect(ref.current.value).toBe('/test ploy')
    expect(ref.current.selectionStart).toBe(6)
    ref.cleanup()
  })

  it('Tab during IME composition does not commit selection', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    ref.current.value = '/'
    ref.current.setSelectionRange(1, 1)

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(result.current.visible).toBe(true)

    act(() => {
      ref.current.dispatchEvent(new Event('compositionstart', { bubbles: true }))
    })

    const handled = result.current.handleKeyDown({ key: 'Tab', preventDefault: () => {} })
    expect(handled).toBe(false)
    expect(ref.current.value).toBe('/') // Unchanged
    ref.cleanup()
  })

  it('dismiss hides autocomplete', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }

    const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

    act(() => {
      ref.current.value = '/'
      ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(result.current.visible).toBe(true)

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.visible).toBe(false)
    ref.cleanup()
  })

  it('handles object-shaped commands', () => {
    const ref = createTextareaRef()
    const textareaRef = { current: ref.current }
    const commands = { custom: [{ name: 'scope' }, { name: 'deploy' }], mcp: [], builtin: [] }

    const { result } = renderHook(() => useAutocomplete(textareaRef, commands))

    expect(result.current.items).toHaveLength(2)
    expect(result.current.items[0].name).toBe('scope')
    ref.cleanup()
  })

  describe('capability gating', () => {
    it('returns items during the capability race', () => {
      mockUseCapabilities = { capabilities: null, runtimeName: null }
      const ref = createTextareaRef()
      const textareaRef = { current: ref.current }

      const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

      expect(result.current.items).toHaveLength(4)
      ref.cleanup()
    })

    it('returns empty items when supports_skills is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_skills: false }),
        runtimeName: 'Goose',
      }
      const ref = createTextareaRef()
      const textareaRef = { current: ref.current }

      const { result } = renderHook(() => useAutocomplete(textareaRef, dictCommands))

      expect(result.current.items).toHaveLength(0)
      expect(result.current.visible).toBe(false)
      ref.cleanup()
    })
  })
})
