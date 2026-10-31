/** Tests for sessionName - the shown name and whether a model wrote it. */

import { describe, expect, it } from 'vitest'
import { displayName, isAutoNamed } from './sessionName'

describe('displayName', () => {
  it('prefers the hand-given name', () => {
    expect(displayName({ name: 'Mine', auto_name: 'Tuning the parser' })).toBe('Mine')
  })

  it('falls back to the automatic name', () => {
    expect(displayName({ name: null, auto_name: 'Tuning the parser' })).toBe('Tuning the parser')
  })

  it('is null for an unnamed or missing session', () => {
    expect(displayName({ name: null, auto_name: null })).toBeNull()
    expect(displayName(undefined)).toBeNull()
  })
})

describe('isAutoNamed', () => {
  it('is true only when the automatic name is the one shown', () => {
    expect(isAutoNamed({ name: null, auto_name: 'Tuning the parser' })).toBe(true)
    expect(isAutoNamed({ name: 'Mine', auto_name: 'Tuning the parser' })).toBe(false)
    expect(isAutoNamed({ name: null, auto_name: null })).toBe(false)
    expect(isAutoNamed(null)).toBe(false)
  })
})
