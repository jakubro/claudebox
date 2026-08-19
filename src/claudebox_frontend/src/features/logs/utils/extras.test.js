/** Tests for extras - log-entry `extra` payload flattening and pill formatting. */

import { describe, expect, it } from 'vitest'
import { flattenExtras, formatPillValue } from './extras'

describe('flattenExtras', () => {
  it('returns an empty list for null, undefined, and non-object input', () => {
    expect(flattenExtras(null)).toEqual([])
    expect(flattenExtras(undefined)).toEqual([])
    expect(flattenExtras('not an object')).toEqual([])
  })

  it('skips the exception key', () => {
    expect(flattenExtras({ exception: 'Traceback...', code: 500 })).toEqual([
      { key: 'code', value: 500 },
    ])
  })

  it('dot-joins one level of nested plain-object keys', () => {
    expect(flattenExtras({ session: { id: 'abc', role: 'user' } })).toEqual([
      { key: 'session.id', value: 'abc' },
      { key: 'session.role', value: 'user' },
    ])
  })

  it('keeps array values as a single pair rather than flattening them', () => {
    expect(flattenExtras({ tags: ['a', 'b'] })).toEqual([{ key: 'tags', value: ['a', 'b'] }])
  })

  it('keeps primitive values as a single pair', () => {
    expect(flattenExtras({ count: 3, active: true, label: 'x' })).toEqual([
      { key: 'count', value: 3 },
      { key: 'active', value: true },
      { key: 'label', value: 'x' },
    ])
  })
})

describe('formatPillValue', () => {
  it('quotes strings', () => {
    expect(formatPillValue('hello')).toBe('"hello"')
  })

  it('renders null as the literal null', () => {
    expect(formatPillValue(null)).toBe('null')
  })

  it('JSON-stringifies plain objects', () => {
    expect(formatPillValue({ a: 1 })).toBe('{"a":1}')
  })

  it('falls back to String() when JSON.stringify throws on a circular object', () => {
    const circular = {}
    circular.self = circular
    expect(formatPillValue(circular)).toBe(String(circular))
  })

  it('stringifies other primitives directly', () => {
    expect(formatPillValue(42)).toBe('42')
    expect(formatPillValue(true)).toBe('true')
    expect(formatPillValue(undefined)).toBe('undefined')
  })
})
