/** Tests for aggregation.js cost aggregation. */

import { describe, expect, it } from 'vitest'
import { aggregateCost, INTERVALS } from './aggregation'

describe('INTERVALS', () => {
  it('defines 4 intervals including All time', () => {
    expect(INTERVALS).toHaveLength(4)
    expect(INTERVALS[3].ms).toBe(Infinity)
  })
})

describe('aggregateCost', () => {
  const now = Date.now()
  const sessions = [
    { started_at: new Date(now - 1000).toISOString(), total_cost_usd: 0.1 },
    { started_at: new Date(now - 100000000).toISOString(), total_cost_usd: 0.5 },
  ]

  it('aggregates all sessions for Infinity interval', () => {
    expect(aggregateCost(sessions, Infinity)).toBeCloseTo(0.6)
  })

  it('filters sessions outside interval', () => {
    // 1 hour interval — only the recent session
    const result = aggregateCost(sessions, 60 * 60 * 1000)
    expect(result).toBeCloseTo(0.1)
  })

  it('returns 0 for empty sessions array', () => {
    expect(aggregateCost([], Infinity)).toBe(0)
  })

  it('treats missing total_cost_usd as 0', () => {
    const sessionsNoCost = [{ started_at: new Date().toISOString() }]
    expect(aggregateCost(sessionsNoCost, Infinity)).toBe(0)
  })
})
