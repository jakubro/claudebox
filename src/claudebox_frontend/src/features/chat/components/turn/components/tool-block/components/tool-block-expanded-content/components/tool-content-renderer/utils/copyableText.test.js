/** Tests for copyable text extraction utilities. */

import { describe, expect, it } from 'vitest'
import {
  extractCodeFromReadOutput,
  extractStartingLineNumber,
  getCopyableText,
} from './copyableText'

describe('getCopyableText', () => {
  describe('Read tool', () => {
    it('strips line numbers from Read output', () => {
      const details = '  1\u2192const x = 1\n  2\u2192const y = 2'
      const result = getCopyableText('Read', details)
      expect(result).toBe('const x = 1\nconst y = 2')
    })

    it('handles Read output with pipe separator', () => {
      const details = '  1│const x = 1\n  2│const y = 2'
      const result = getCopyableText('Read', details)
      expect(result).toBe('const x = 1\nconst y = 2')
    })

    it('handles Read output with tab separator (cat -n format)', () => {
      const details = '     1\tconst x = 1\n     2\tconst y = 2'
      const result = getCopyableText('Read', details)
      expect(result).toBe('const x = 1\nconst y = 2')
    })
  })

  describe('Write tool', () => {
    it('strips line numbers from Write output', () => {
      const details = '  1\u2192export default {}\n  2\u2192'
      const result = getCopyableText('Write', details)
      expect(result).toBe('export default {}\n')
    })
  })

  describe('Edit tool', () => {
    it('strips diff prefixes from added lines', () => {
      const details = '+ const newLine = true'
      const result = getCopyableText('Edit', details)
      expect(result).toBe('const newLine = true')
    })

    it('strips diff prefixes from removed lines', () => {
      const details = '- const oldLine = false'
      const result = getCopyableText('Edit', details)
      expect(result).toBe('const oldLine = false')
    })

    it('removes separator lines', () => {
      const details = '- old line\n· \n+ new line'
      const result = getCopyableText('Edit', details)
      expect(result).toBe('old line\nnew line')
    })

    it('preserves lines without diff prefix', () => {
      const details = 'context line\n+ added line'
      const result = getCopyableText('Edit', details)
      expect(result).toBe('context line\nadded line')
    })

    it('filters empty lines produced by separator stripping', () => {
      const details = '· \n· '
      const result = getCopyableText('Edit', details)
      expect(result).toBe('')
    })
  })

  describe('other tools', () => {
    it('returns text as-is for Bash tool', () => {
      const details = 'file1.txt\nfile2.txt'
      const result = getCopyableText('Bash', details)
      expect(result).toBe('file1.txt\nfile2.txt')
    })

    it('returns text as-is for unknown tool', () => {
      const details = 'some output'
      const result = getCopyableText('Grep', details)
      expect(result).toBe('some output')
    })
  })
})

describe('extractCodeFromReadOutput', () => {
  it('strips line numbers with arrow separator', () => {
    const input = '  1\u2192function foo() {\n  2\u2192  return 42\n  3\u2192}'
    const result = extractCodeFromReadOutput(input)
    expect(result).toBe('function foo() {\n  return 42\n}')
  })

  it('strips line numbers with pipe separator', () => {
    const input = '  1│const a = 1\n  2│const b = 2'
    const result = extractCodeFromReadOutput(input)
    expect(result).toBe('const a = 1\nconst b = 2')
  })

  it('strips line numbers with tab separator (cat -n format)', () => {
    const input = '     1\tconst a = 1\n     2\tconst b = 2'
    const result = extractCodeFromReadOutput(input)
    expect(result).toBe('const a = 1\nconst b = 2')
  })

  it('handles multi-digit line numbers', () => {
    const input = ' 99\u2192line 99\n100\u2192line 100\n101\u2192line 101'
    const result = extractCodeFromReadOutput(input)
    expect(result).toBe('line 99\nline 100\nline 101')
  })

  it('preserves lines that do not match line-number pattern', () => {
    const input = 'no line number here'
    const result = extractCodeFromReadOutput(input)
    expect(result).toBe('no line number here')
  })

  it('handles empty input', () => {
    const result = extractCodeFromReadOutput('')
    expect(result).toBe('')
  })

  it('preserves indentation after line number', () => {
    const input = '  1\u2192  indented\n  2\u2192    more indented'
    const result = extractCodeFromReadOutput(input)
    expect(result).toBe('  indented\n    more indented')
  })
})

describe('extractStartingLineNumber', () => {
  it('returns 1 for output starting at line 1', () => {
    const input = '  1\u2192const x = 1\n  2\u2192const y = 2'
    expect(extractStartingLineNumber(input)).toBe(1)
  })

  it('returns offset line number for Read with offset', () => {
    const input = '    50\tfunction foo() {\n    51\t  return 42'
    expect(extractStartingLineNumber(input)).toBe(50)
  })

  it('returns offset with arrow separator', () => {
    const input = ' 99\u2192line 99\n100\u2192line 100'
    expect(extractStartingLineNumber(input)).toBe(99)
  })

  it('returns 1 for non-matching input', () => {
    expect(extractStartingLineNumber('no line number here')).toBe(1)
  })

  it('returns 1 for empty input', () => {
    expect(extractStartingLineNumber('')).toBe(1)
  })
})
