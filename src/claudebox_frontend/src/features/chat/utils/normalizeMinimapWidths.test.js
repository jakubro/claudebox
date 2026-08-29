/** Tests for normalizeWidths - duration-to-width normalization shared by both overviews. */

import { describe, expect, it } from 'vitest'
import { MINIMAP_MAX_WIDTH, MINIMAP_MIN_WIDTH } from '../../../config/dimensions'
import { normalizeWidths } from './normalizeMinimapWidths'

/** One segment holding a flat list of `{duration}` turns, matching normalizeWidths' input shape. */
function segment(durations) {
  return { turns: durations.map(duration => ({ duration })) }
}

describe('normalizeWidths', () => {
  it('gives the longest duration across every segment the max width', () => {
    const [result] = normalizeWidths([segment([0, 100])])

    expect(result.turns[1].width).toBe(MINIMAP_MAX_WIDTH)
  })

  it('gives a zero duration the min width', () => {
    const [result] = normalizeWidths([segment([0, 100])])

    expect(result.turns[0].width).toBe(MINIMAP_MIN_WIDTH)
  })

  it('normalizes the longest duration against the maximum across every segment, not just its own', () => {
    const [first, second] = normalizeWidths([segment([50]), segment([100])])

    expect(first.turns[0].width).toBeLessThan(second.turns[0].width)
  })

  it('gives a null duration (still running, no verdict yet) the min width like a zero one', () => {
    const [result] = normalizeWidths([segment([null, 100])])

    expect(result.turns[0].width).toBe(MINIMAP_MIN_WIDTH)
  })

  it('avoids dividing by zero when every duration is zero', () => {
    const [result] = normalizeWidths([segment([0, 0])])

    expect(result.turns.every(t => t.width === MINIMAP_MIN_WIDTH)).toBe(true)
  })

  it('preserves every other field on the turn and the segment', () => {
    const [result] = normalizeWidths([{ index: 3, turns: [{ duration: 10, id: 'a', height: 42 }] }])

    expect(result.index).toBe(3)
    expect(result.turns[0]).toMatchObject({ id: 'a', height: 42, duration: 10 })
  })
})
