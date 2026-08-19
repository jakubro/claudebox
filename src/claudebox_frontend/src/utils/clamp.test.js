/** Tests for clamp - numeric range clamping. */

import { describe, expect, it } from 'vitest'
import { clamp } from './clamp'

describe('clamp', () => {
  it('returns value unchanged when inside range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to min when value is below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it('clamps to max when value is above range', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('returns the boundary value when value equals min or max', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('handles a single-point range', () => {
    expect(clamp(5, 3, 3)).toBe(3)
  })
})
