/** Tests for categorize.js command categorization. */

import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS, categorizeCommands, flattenCommands, TABS } from './categorize'

describe('TABS', () => {
  it('defines custom, mcp, and all tabs', () => {
    expect(TABS.map(t => t.id)).toEqual(['custom', 'mcp', 'all'])
  })
})

describe('categorizeCommands', () => {
  it('builds custom, mcp, builtin, and all categories', () => {
    const commands = {
      custom: [{ name: 'greet' }, { name: 'farewell' }],
      mcp: [{ name: 'mcp__jina__search' }],
      builtin: [{ name: 'compact' }, { name: 'cost' }],
    }
    const result = categorizeCommands(commands)

    expect(result.custom).toEqual([{ name: 'greet' }, { name: 'farewell' }])
    expect(result.mcp).toEqual([{ name: 'mcp__jina__search' }])
    expect(result.builtin).toEqual([{ name: 'compact' }, { name: 'cost' }])
    expect(result.all).toHaveLength(5)
  })

  it('passes through object entries with metadata', () => {
    const commands = {
      custom: [{ name: 'greet', usage: '/greet [name]', description: 'Greet by name' }],
      mcp: [],
      builtin: [],
    }
    const result = categorizeCommands(commands)

    expect(result.custom).toEqual([
      { name: 'greet', usage: '/greet [name]', description: 'Greet by name' },
    ])
  })

  it('handles empty categories', () => {
    const result = categorizeCommands({ custom: [], mcp: [], builtin: [] })

    expect(result.custom).toEqual([])
    expect(result.mcp).toEqual([])
    expect(result.builtin).toEqual([])
    expect(result.all).toEqual([])
  })

  it('handles null/undefined input', () => {
    const result = categorizeCommands(null)

    expect(result.custom).toEqual([])
    expect(result.mcp).toEqual([])
    expect(result.builtin).toEqual([])
    expect(result.all).toEqual([])
  })
})

describe('flattenCommands', () => {
  it('flattens categorized commands with category metadata', () => {
    const categorized = {
      custom: [{ name: 'greet', description: 'Greet by name' }],
      mcp: [{ name: 'mcp__jina__search' }],
      builtin: [{ name: 'compact' }],
    }
    const result = flattenCommands(categorized)

    expect(result).toEqual([
      { name: 'greet', description: 'Greet by name', category: 'custom' },
      { name: 'compact', category: 'builtin' },
      { name: 'mcp__jina__search', category: 'mcp' },
    ])
  })

  it('handles empty categories', () => {
    const result = flattenCommands({ custom: [], mcp: [], builtin: [] })

    expect(result).toEqual([])
  })

  it('excludes non-invocable commands when option set', () => {
    const categorized = {
      custom: [
        { name: 'greet', user_invocable: true },
        { name: 'internal', user_invocable: false },
      ],
      mcp: [],
      builtin: [{ name: 'compact' }],
    }
    const result = flattenCommands(categorized, { excludeNonInvocable: true })

    expect(result.map(r => r.name)).toEqual(['greet', 'compact'])
  })

  it('includes non-invocable commands by default', () => {
    const categorized = {
      custom: [{ name: 'internal', user_invocable: false }],
      mcp: [],
      builtin: [],
    }
    const result = flattenCommands(categorized)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('internal')
  })
})

describe('CATEGORY_COLORS', () => {
  it('defines colors for all three categories', () => {
    expect(CATEGORY_COLORS.custom).toBeDefined()
    expect(CATEGORY_COLORS.builtin).toBeDefined()
    expect(CATEGORY_COLORS.mcp).toBeDefined()
  })
})
