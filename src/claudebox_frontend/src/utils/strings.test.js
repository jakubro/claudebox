/** Tests for strings - pure string helpers. */

import { describe, expect, it } from 'vitest'
import { capitalize } from './strings'

describe('capitalize', () => {
  it('upper-cases the first character', () => {
    expect(capitalize('running')).toBe('Running')
  })

  it('returns an empty string for empty input', () => {
    expect(capitalize('')).toBe('')
  })

  it('returns an empty string for falsy input', () => {
    expect(capitalize(null)).toBe('')
    expect(capitalize(undefined)).toBe('')
  })

  it('leaves an already-capitalized word unchanged', () => {
    expect(capitalize('Running')).toBe('Running')
  })
})
