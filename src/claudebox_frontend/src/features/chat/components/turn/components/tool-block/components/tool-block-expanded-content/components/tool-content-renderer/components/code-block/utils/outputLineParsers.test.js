/** Tests for output line parsers. */

import { describe, expect, it } from 'vitest'
import { parseEditLines, parseGrepLines, parseReadWriteLines } from './outputLineParsers'

describe('parseReadWriteLines', () => {
  it('parses Read format with arrow separator', () => {
    const details = '     1→# Heading\n     2→\n     3→Body text'
    const lines = parseReadWriteLines(details)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ type: 'normal', lineNum: 1, content: '# Heading' })
    expect(lines[1]).toEqual({ type: 'normal', lineNum: 2, content: '' })
    expect(lines[2]).toEqual({ type: 'normal', lineNum: 3, content: 'Body text' })
  })

  it('parses Write format with narrower padding', () => {
    const details = ' 1→/**\n 2→ * Comment.\n 3→ */'
    const lines = parseReadWriteLines(details)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ type: 'normal', lineNum: 1, content: '/**' })
    expect(lines[1]).toEqual({ type: 'normal', lineNum: 2, content: ' * Comment.' })
    expect(lines[2]).toEqual({ type: 'normal', lineNum: 3, content: ' */' })
  })

  it('parses lines with │ separator', () => {
    const details = '  1│first\n  2│second'
    const lines = parseReadWriteLines(details)

    expect(lines[0]).toEqual({ type: 'normal', lineNum: 1, content: 'first' })
    expect(lines[1]).toEqual({ type: 'normal', lineNum: 2, content: 'second' })
  })

  it('parses cat -n format with tab separator', () => {
    const details = '     1\t# Heading\n     2\t\n     3\tBody text'
    const lines = parseReadWriteLines(details)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ type: 'normal', lineNum: 1, content: '# Heading' })
    expect(lines[1]).toEqual({ type: 'normal', lineNum: 2, content: '' })
    expect(lines[2]).toEqual({ type: 'normal', lineNum: 3, content: 'Body text' })
  })

  it('parses cat -n format with offset line numbers', () => {
    const details = '    50\tfunction foo() {\n    51\t  return 42\n    52\t}'
    const lines = parseReadWriteLines(details)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ type: 'normal', lineNum: 50, content: 'function foo() {' })
    expect(lines[1]).toEqual({ type: 'normal', lineNum: 51, content: '  return 42' })
    expect(lines[2]).toEqual({ type: 'normal', lineNum: 52, content: '}' })
  })

  it('falls back to plain normal line for non-matching lines', () => {
    const details = 'no line number here'
    const lines = parseReadWriteLines(details)

    expect(lines).toEqual([{ type: 'normal', content: 'no line number here' }])
  })
})

describe('parseGrepLines', () => {
  it('parses single-file grep output with matches and context', () => {
    const details = '93:  overflow: hidden;\n94-  text-overflow: ellipsis;'
    const { lines, isMultiFile, isFilesOnly } = parseGrepLines(details, null, false)

    expect(isMultiFile).toBe(false)
    expect(isFilesOnly).toBe(false)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      type: 'match',
      lineNum: 93,
      file: undefined,
      content: '  overflow: hidden;',
    })
    expect(lines[1]).toEqual({
      type: 'context',
      lineNum: 94,
      file: undefined,
      content: '  text-overflow: ellipsis;',
    })
  })

  it('parses multi-file grep output with basenames by default', () => {
    const details =
      'src/styles/tools.css:93:  overflow: hidden;\nsrc/styles/chat.css:211:  overflow: hidden;'
    const { lines, isMultiFile } = parseGrepLines(details, null, false)

    expect(isMultiFile).toBe(true)
    expect(lines[0].file).toBe('tools.css')
    expect(lines[1].file).toBe('chat.css')
  })

  it('shows full paths when showFullPaths is true', () => {
    const details = 'src/styles/tools.css:93:  overflow: hidden;'
    const { lines } = parseGrepLines(details, null, true)

    expect(lines[0].file).toBe('src/styles/tools.css')
  })

  it('parses separator lines', () => {
    const details = '93:  overflow: hidden;\n--\n211:  overflow: hidden;'
    const { lines } = parseGrepLines(details, null, false)

    expect(lines).toHaveLength(3)
    expect(lines[1]).toEqual({ type: 'separator' })
  })

  it('parses files-only output and strips summary line', () => {
    const details = 'Found 3 files\nsrc/a.js\nsrc/b.js\nsrc/c.js'
    const { lines, isFilesOnly } = parseGrepLines(details, 'files_with_matches', false)

    expect(isFilesOnly).toBe(true)
    // "Found 3 files" should be stripped
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ type: 'normal', content: 'src/a.js' })
  })

  it('handles single file summary', () => {
    const details = 'Found 1 file\nsrc/a.js'
    const { lines } = parseGrepLines(details, 'files_with_matches', false)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ type: 'normal', content: 'src/a.js' })
  })

  it('parses multi-file context lines', () => {
    const details = 'src/foo.js-10-  const x = 1'
    const { lines } = parseGrepLines(details, null, false)

    expect(lines[0].type).toBe('context')
    expect(lines[0].lineNum).toBe(10)
    expect(lines[0].file).toBe('foo.js')
  })
})

describe('parseEditLines', () => {
  it('parses context lines by stripping 2-char prefix', () => {
    const lines = parseEditLines('  const foo = "bar"')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ type: 'diff-context', lineNum: 1, content: 'const foo = "bar"' })
  })

  it('parses orphan add lines', () => {
    const lines = parseEditLines('+ new line')

    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('diff-add')
    expect(lines[0].content).toBe('new line')
    expect(lines[0].lineNum).toBeUndefined()
  })

  it('parses separator lines', () => {
    const lines = parseEditLines('· · ·')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ type: 'separator' })
  })

  it('pairs consecutive remove/add lines with oldLine/newLine data', () => {
    const details = '- const baz = 42\n+ const baz = 99'
    const lines = parseEditLines(details)

    expect(lines).toHaveLength(2)
    expect(lines[0].type).toBe('diff-remove')
    expect(lines[0].lineNum).toBe(1)
    expect(lines[0].oldLine).toBe('const baz = 42')
    expect(lines[0].newLine).toBe('const baz = 99')
    expect(lines[1].type).toBe('diff-add')
    expect(lines[1].lineNum).toBeUndefined()
    expect(lines[1].oldLine).toBe('const baz = 42')
    expect(lines[1].newLine).toBe('const baz = 99')
  })

  it('handles unpaired remove lines', () => {
    const details = '- removed line 1\n- removed line 2\n+ added line 1'
    const lines = parseEditLines(details)

    // Line 1 paired with add, line 2 unpaired
    expect(lines).toHaveLength(3)
    expect(lines[0].type).toBe('diff-remove')
    expect(lines[0].lineNum).toBe(1)
    expect(lines[1].type).toBe('diff-add')
    expect(lines[2].type).toBe('diff-remove')
    expect(lines[2].lineNum).toBe(2)
    expect(lines[2].content).toBe('removed line 2')
  })

  it('handles unpaired add lines after removes', () => {
    const details = '- removed\n+ added 1\n+ added 2'
    const lines = parseEditLines(details)

    expect(lines).toHaveLength(3)
    expect(lines[0].type).toBe('diff-remove')
    expect(lines[0].lineNum).toBe(1)
    expect(lines[1].type).toBe('diff-add')
    // Second add is unpaired
    expect(lines[2].type).toBe('diff-add')
    expect(lines[2].content).toBe('added 2')
  })

  it('parses a complete edit diff with sequential line numbers', () => {
    const details = '  const foo = "bar"\n- const baz = 42\n+ const baz = 99\n  export { foo, baz }'
    const lines = parseEditLines(details)

    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ type: 'diff-context', lineNum: 1 })
    expect(lines[1]).toMatchObject({ type: 'diff-remove', lineNum: 2 })
    expect(lines[2]).toMatchObject({ type: 'diff-add' })
    expect(lines[2].lineNum).toBeUndefined()
    expect(lines[3]).toMatchObject({ type: 'diff-context', lineNum: 3 })
  })

  it('uses startLine parameter for line numbering offset', () => {
    const details = '  const foo = "bar"\n- const baz = 42\n+ const baz = 99\n  export { foo, baz }'
    const lines = parseEditLines(details, 45)

    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ type: 'diff-context', lineNum: 45 })
    expect(lines[1]).toMatchObject({ type: 'diff-remove', lineNum: 46 })
    expect(lines[3]).toMatchObject({ type: 'diff-context', lineNum: 47 })
  })
})
