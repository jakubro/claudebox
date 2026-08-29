/** Tests for predictTerminalEntryHeight and deriveEntryMetrics - line-count-only prediction. */

import { describe, expect, it } from 'vitest'
import {
  TERMINAL_ENTRY_BASE_HEIGHT_PX,
  TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX,
  TERMINAL_LINE_HEIGHT_PX,
} from '../../../config/dimensions'
import { deriveEntryMetrics, predictTerminalEntryHeight } from './predictTerminalEntryHeight'

/** Entry shape as deriveTerminalEntries would produce it. */
function entry(overrides = {}) {
  return {
    id: 'tu_1',
    turnId: 't-1',
    command: 'ls -la',
    description: null,
    result: { content: 'a.txt\nb.txt', is_error: false },
    ...overrides,
  }
}

describe('predictTerminalEntryHeight', () => {
  it('returns MIN for null metrics', () => {
    expect(predictTerminalEntryHeight(null)).toBe(TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX)
  })

  it('prices a pending entry as command + "Running..." line, no comment', () => {
    const metrics = { hasComment: false, pending: true, outputText: '', isPersisted: false }
    const expected = TERMINAL_ENTRY_BASE_HEIGHT_PX + 2 * TERMINAL_LINE_HEIGHT_PX
    expect(predictTerminalEntryHeight(metrics)).toBe(
      Math.max(expected, TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX),
    )
  })

  it('adds one line for a pending entry with a comment', () => {
    const withComment = predictTerminalEntryHeight({
      hasComment: true,
      pending: true,
      outputText: '',
      isPersisted: false,
    })
    const withoutComment = predictTerminalEntryHeight({
      hasComment: false,
      pending: true,
      outputText: '',
      isPersisted: false,
    })
    // Compared against each side's own clamped expectation - a two-line pending entry sits
    // below MIN and gets clamped, so a raw delta between the two isn't always one line.
    expect(withComment).toBe(
      Math.max(
        TERMINAL_ENTRY_BASE_HEIGHT_PX + 3 * TERMINAL_LINE_HEIGHT_PX,
        TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX,
      ),
    )
    expect(withoutComment).toBe(
      Math.max(
        TERMINAL_ENTRY_BASE_HEIGHT_PX + 2 * TERMINAL_LINE_HEIGHT_PX,
        TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX,
      ),
    )
  })

  it('prices a resolved entry by hard line count, never wrapping on content length', () => {
    const oneLine = predictTerminalEntryHeight({
      hasComment: false,
      pending: false,
      outputText: 'x'.repeat(500),
      isPersisted: false,
    })
    const expected = TERMINAL_ENTRY_BASE_HEIGHT_PX + 2 * TERMINAL_LINE_HEIGHT_PX
    expect(oneLine).toBe(Math.max(expected, TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX))
  })

  it('adds one line per newline in the output', () => {
    // Four lines above two (rather than two above one) keeps both sides clear of MIN, so the
    // delta reflects the formula rather than one side's clamp.
    const four = predictTerminalEntryHeight({
      hasComment: false,
      pending: false,
      outputText: 'one\ntwo\nthree\nfour',
      isPersisted: false,
    })
    const two = predictTerminalEntryHeight({
      hasComment: false,
      pending: false,
      outputText: 'one\ntwo',
      isPersisted: false,
    })
    expect(four - two).toBe(2 * TERMINAL_LINE_HEIGHT_PX)
  })

  it('adds one line for persisted output (truncation notice)', () => {
    // Two output lines (rather than one) keeps the non-persisted side clear of MIN too.
    const persisted = predictTerminalEntryHeight({
      hasComment: false,
      pending: false,
      outputText: 'preview one\npreview two',
      isPersisted: true,
    })
    const plain = predictTerminalEntryHeight({
      hasComment: false,
      pending: false,
      outputText: 'preview one\npreview two',
      isPersisted: false,
    })
    expect(persisted - plain).toBe(TERMINAL_LINE_HEIGHT_PX)
  })

  it('clamps to MIN for an entry with no output', () => {
    const metrics = { hasComment: false, pending: false, outputText: '', isPersisted: false }
    expect(predictTerminalEntryHeight(metrics)).toBeGreaterThanOrEqual(
      TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX,
    )
  })
})

describe('deriveEntryMetrics', () => {
  it('marks an entry with no result as pending', () => {
    const metrics = deriveEntryMetrics(entry({ result: null }))
    expect(metrics).toMatchObject({ pending: true, outputText: '', isPersisted: false })
  })

  it('carries hasComment from the entry description', () => {
    expect(deriveEntryMetrics(entry({ description: 'List files' })).hasComment).toBe(true)
    expect(deriveEntryMetrics(entry({ description: null })).hasComment).toBe(false)
  })

  it('extracts plain-text output verbatim for a resolved entry', () => {
    const metrics = deriveEntryMetrics(
      entry({ result: { content: 'a.txt\nb.txt', is_error: false } }),
    )
    expect(metrics.pending).toBe(false)
    expect(metrics.outputText).toBe('a.txt\nb.txt')
    expect(metrics.isPersisted).toBe(false)
  })

  it('marks a pending entry as not failed - running carries no verdict yet', () => {
    expect(deriveEntryMetrics(entry({ result: null })).isFailed).toBe(false)
  })

  it('marks isFailed from result.is_error, the same predicate TerminalEntry renders from', () => {
    const metrics = deriveEntryMetrics(entry({ result: { content: 'boom', is_error: true } }))
    expect(metrics.isFailed).toBe(true)
  })

  it('marks isFailed false for a passing result', () => {
    const metrics = deriveEntryMetrics(entry({ result: { content: 'ok', is_error: false } }))
    expect(metrics.isFailed).toBe(false)
  })
})
