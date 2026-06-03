/** Tests for extractTicketId — display-ready ID extraction from ticket paths. */

import { describe, expect, it } from 'vitest'
import { extractTicketId } from './ticketId'

describe('extractTicketId', () => {
  it('extracts dotted numeric prefix from typical ticket filenames', () => {
    expect(extractTicketId('tickets/active/99.001-sample-title.md')).toBe('99.001')
    expect(extractTicketId('tickets/active/99.002-another-sample.md')).toBe('99.002')
  })

  it('extracts deeper numeric prefixes with multiple dots', () => {
    expect(extractTicketId('tickets/active/99.0.001-deep-sample.md')).toBe('99.0.001')
  })

  it('preserves alphanumeric letter suffixes', () => {
    expect(extractTicketId('tickets/active/99.0.A-foo.md')).toBe('99.0.A')
    expect(extractTicketId('tickets/active/99.0.B-bar.md')).toBe('99.0.B')
  })

  it('returns everything before the first hyphen for non-numeric leading IDs', () => {
    expect(extractTicketId('tickets/active/arbitrary-name-here.md')).toBe('arbitrary')
  })

  it('falls back to the file stem when no hyphen is present', () => {
    expect(extractTicketId('tickets/active/99.0.A.md')).toBe('99.0.A')
    expect(extractTicketId('tickets/active/no_hyphen_here.md')).toBe('no_hyphen_here')
  })

  it('handles paths without a directory prefix', () => {
    expect(extractTicketId('99.001-sample-title.md')).toBe('99.001')
  })
})
