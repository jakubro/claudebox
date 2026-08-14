/** editorUrl.js tests - template resolution for the "open in editor" affordance. */

import { describe, expect, it } from 'vitest'
import { resolveEditorUrl } from './editorUrl'

describe('resolveEditorUrl', () => {
  it('substitutes both placeholders', () => {
    expect(resolveEditorUrl('vscode://file/{path}:{line}', { path: '/src/app.js', line: 5 })).toBe(
      'vscode://file/%2Fsrc%2Fapp.js:5',
    )
  })

  it('defaults line to 1 when not provided', () => {
    expect(resolveEditorUrl('vscode://file/{path}:{line}', { path: '/src/app.js' })).toBe(
      'vscode://file/%2Fsrc%2Fapp.js:1',
    )
  })

  it('defaults line to 1 when explicitly null', () => {
    expect(
      resolveEditorUrl('vscode://file/{path}:{line}', { path: '/src/app.js', line: null }),
    ).toBe('vscode://file/%2Fsrc%2Fapp.js:1')
  })

  it('encodes a path containing spaces, #, &, and non-ASCII characters', () => {
    const path = '/src/my file #1 & résumé.js'
    const url = resolveEditorUrl('vscode://file/{path}', { path })
    expect(url).toBe(`vscode://file/${encodeURIComponent(path)}`)
    expect(decodeURIComponent(url.replace('vscode://file/', ''))).toBe(path)
  })

  it('leaves the template structure (?, &, =) untouched around the substituted value', () => {
    const url = resolveEditorUrl('jetbrains://idea/navigate/reference?project=Foo&path={path}', {
      path: '/src/app.js',
    })
    expect(url).toBe('jetbrains://idea/navigate/reference?project=Foo&path=%2Fsrc%2Fapp.js')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(resolveEditorUrl('editor://{unknown}/{path}', { path: '/a.js' })).toBe(
      'editor://{unknown}/%2Fa.js',
    )
  })

  it('returns the template verbatim when it has no placeholders', () => {
    expect(resolveEditorUrl('editor://open', { path: '/a.js' })).toBe('editor://open')
  })

  it('returns null when no template is configured', () => {
    expect(resolveEditorUrl(null, { path: '/a.js' })).toBeNull()
    expect(resolveEditorUrl('', { path: '/a.js' })).toBeNull()
  })

  it('substitutes a placeholder that repeats in the template', () => {
    expect(resolveEditorUrl('{path}#L{line}-{path}', { path: '/a.js', line: 3 })).toBe(
      '%2Fa.js#L3-%2Fa.js',
    )
  })
})
