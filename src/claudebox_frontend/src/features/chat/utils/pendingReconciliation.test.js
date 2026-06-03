/** Tests for pendingReconciliation.js delivery detection. */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/parsers', () => ({
  parseSlashCommand: vi.fn(content => {
    const match = content.match(
      /<command-name>([^<]+)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/,
    )
    if (match) {
      return { cmd: match[1], args: match[2]?.trim() || '' }
    }
    return null
  }),
}))

import { getDeliveredContents, isDelivered } from './pendingReconciliation'

describe('getDeliveredContents', () => {
  it('collects content after the given timestamp', () => {
    const events = [
      { timestamp: 100, content: 'old' },
      { timestamp: 200, content: 'new' },
    ]
    const delivered = getDeliveredContents(events, 150)

    expect(delivered.has('new')).toBe(true)
    expect(delivered.has('old')).toBe(false)
  })

  it('includes parsed slash command forms', () => {
    const events = [
      {
        timestamp: 200,
        content: '<command-name>/help</command-name><command-args>topic</command-args>',
      },
    ]
    const delivered = getDeliveredContents(events, 100)

    expect(delivered.has('/help topic')).toBe(true)
  })

  it('returns empty set when no events match', () => {
    const delivered = getDeliveredContents([], 0)
    expect(delivered.size).toBe(0)
  })
})

describe('isDelivered', () => {
  it('returns true for exact match', () => {
    const delivered = new Set(['hello'])
    expect(isDelivered(delivered, 'hello')).toBe(true)
  })

  it('returns false when not in set', () => {
    const delivered = new Set(['hello'])
    expect(isDelivered(delivered, 'world')).toBe(false)
  })

  it('normalizes whitespace between slash command and args', () => {
    const delivered = new Set(['/cmd args'])
    expect(isDelivered(delivered, '/cmd   args')).toBe(true)
  })

  it('does not normalize non-slash content', () => {
    const delivered = new Set(['plain text'])
    expect(isDelivered(delivered, 'plain  text')).toBe(false)
  })
})
