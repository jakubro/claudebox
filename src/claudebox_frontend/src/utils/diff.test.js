/** Tests for diff utilities. */

import { describe, expect, it } from 'vitest'
import { buildDiffSummary, generateDiff } from './diff'

describe('buildDiffSummary', () => {
  it('shows only additions when no removals', () => {
    expect(buildDiffSummary(5, 0)).toBe('+5 lines')
  })

  it('shows singular for single addition', () => {
    expect(buildDiffSummary(1, 0)).toBe('+1 line')
  })

  it('shows only removals when no additions', () => {
    expect(buildDiffSummary(0, 3)).toBe('-3 lines')
  })

  it('shows singular for single removal', () => {
    expect(buildDiffSummary(0, 1)).toBe('-1 line')
  })

  it('shows both when additions and removals', () => {
    expect(buildDiffSummary(2, 4)).toBe('+2, -4')
  })

  it('returns "No changes" when neither additions nor removals', () => {
    expect(buildDiffSummary(0, 0)).toBe('No changes')
  })
})

describe('generateDiff', () => {
  it('returns no changes for identical strings', () => {
    const result = generateDiff('hello\n', 'hello\n')

    expect(result.summary).toBe('No changes')
    expect(result.formatted).toContain('hello')
    expect(result.formatted).not.toMatch(/^[+-] /m)
  })

  it('detects added lines', () => {
    const result = generateDiff('line1\n', 'line1\nline2\n')

    expect(result.summary).toContain('+')
    expect(result.formatted).toContain('+ line2')
  })

  it('detects removed lines', () => {
    const result = generateDiff('line1\nline2\n', 'line1\n')

    expect(result.summary).toContain('-')
    expect(result.formatted).toContain('- line2')
  })

  it('detects modifications (additions and removals)', () => {
    const result = generateDiff('old line\n', 'new line\n')

    expect(result.summary).toMatch(/\+\d+/)
    expect(result.summary).toMatch(/-\d+/)
    expect(result.formatted).toContain('- old line')
    expect(result.formatted).toContain('+ new line')
  })

  it('handles empty old string (all additions)', () => {
    const result = generateDiff('', 'line1\nline2\n')

    expect(result.summary).toContain('+')
    expect(result.formatted).toContain('+ line1')
    expect(result.formatted).toContain('+ line2')
  })

  it('handles empty new string (all removals)', () => {
    const result = generateDiff('line1\nline2\n', '')

    expect(result.summary).toContain('-')
    expect(result.formatted).toContain('- line1')
    expect(result.formatted).toContain('- line2')
  })

  it('handles both strings empty', () => {
    const result = generateDiff('', '')

    expect(result.summary).toBe('No changes')
  })

  it('returns an object with summary and formatted keys', () => {
    const result = generateDiff('a\n', 'b\n')

    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('formatted')
    expect(typeof result.summary).toBe('string')
    expect(typeof result.formatted).toBe('string')
  })

  it('preserves context lines with proper prefix', () => {
    const oldStr = 'line1\nline2\nline3\n'
    const newStr = 'line1\nchanged\nline3\n'

    const result = generateDiff(oldStr, newStr)

    expect(result.formatted).toContain('  line1')
    expect(result.formatted).toContain('  line3')
    expect(result.formatted).toContain('- line2')
    expect(result.formatted).toContain('+ changed')
  })

  it('handles multi-line additions correctly', () => {
    const oldStr = 'line1\n'
    const newStr = 'line1\nline2\nline3\nline4\n'

    const result = generateDiff(oldStr, newStr)

    expect(result.summary).toBe('+3 lines')
    expect(result.formatted).toContain('+ line2')
    expect(result.formatted).toContain('+ line3')
    expect(result.formatted).toContain('+ line4')
  })
})
