/** Tests for footer rate-limit helpers. */

import { describe, expect, it } from 'vitest'
import {
  deriveRateLimitEntry,
  formatRateLimitLabel,
  formatRateLimitTooltip,
  getRateLimitItemColor,
  isRateLimitEntryLive,
} from './rateLimits'

describe('deriveRateLimitEntry', () => {
  it('maps five_hour to the session window', () => {
    const entry = deriveRateLimitEntry({
      status: 'allowed_warning',
      resets_at: 1786311000,
      rate_limit_type: 'five_hour',
      utilization: 0.9,
    })
    expect(entry).toEqual({
      window: 'session',
      status: 'allowed_warning',
      utilization: 0.9,
      resetsAt: 1786311000_000,
    })
  })

  it('maps seven_day to the weekly window', () => {
    const entry = deriveRateLimitEntry({
      status: 'allowed_warning',
      resets_at: 1786311000,
      rate_limit_type: 'seven_day',
      utilization: 0.78,
    })
    expect(entry.window).toBe('weekly')
  })

  it('carries a null utilization through unchanged (normal allowed state)', () => {
    const entry = deriveRateLimitEntry({
      status: 'allowed',
      resets_at: 1786311000,
      rate_limit_type: 'five_hour',
      utilization: null,
    })
    expect(entry.utilization).toBeNull()
  })

  it('returns null for rate_limit_type outside the mapped windows', () => {
    expect(
      deriveRateLimitEntry({
        status: 'allowed_warning',
        resets_at: 1786311000,
        rate_limit_type: 'seven_day_opus',
        utilization: 0.9,
      }),
    ).toBeNull()
  })

  it('returns null for missing message_data', () => {
    expect(deriveRateLimitEntry(null)).toBeNull()
    expect(deriveRateLimitEntry(undefined)).toBeNull()
  })

  it('carries a null resets_at through as a null resetsAt', () => {
    const entry = deriveRateLimitEntry({
      status: 'rejected',
      resets_at: null,
      rate_limit_type: 'five_hour',
      utilization: null,
    })
    expect(entry.resetsAt).toBeNull()
  })
})

describe('isRateLimitEntryLive', () => {
  it('is live when resetsAt is in the future', () => {
    expect(isRateLimitEntryLive({ resetsAt: Date.now() + 1000 })).toBe(true)
  })

  it('is not live once resetsAt has passed', () => {
    expect(isRateLimitEntryLive({ resetsAt: Date.now() - 1000 })).toBe(false)
  })

  it('is live with no resetsAt (unknown reset time never expires on its own)', () => {
    expect(isRateLimitEntryLive({ resetsAt: null })).toBe(true)
  })
})

describe('formatRateLimitLabel', () => {
  it('formats a session percentage', () => {
    expect(
      formatRateLimitLabel({ window: 'session', status: 'allowed_warning', utilization: 0.86 }),
    ).toBe('Session 86%')
  })

  it('formats a weekly percentage', () => {
    expect(
      formatRateLimitLabel({ window: 'weekly', status: 'allowed_warning', utilization: 0.91 }),
    ).toBe('Weekly 91%')
  })

  it('formats a reached limit with no percentage', () => {
    expect(formatRateLimitLabel({ window: 'weekly', status: 'rejected', utilization: null })).toBe(
      'Weekly limit reached',
    )
  })

  it('rounds the percentage', () => {
    expect(
      formatRateLimitLabel({ window: 'session', status: 'allowed_warning', utilization: 0.755 }),
    ).toBe('Session 76%')
  })
})

describe('formatRateLimitTooltip', () => {
  it('names the window, percentage, and reset time', () => {
    const resetsAt = new Date('2026-08-20T12:00:00Z').getTime()
    const tooltip = formatRateLimitTooltip({
      window: 'weekly',
      status: 'allowed_warning',
      utilization: 0.91,
      resetsAt,
    })
    expect(tooltip).toContain('Weekly')
    expect(tooltip).toContain('91%')
    expect(tooltip).toContain(new Date(resetsAt).toLocaleString())
  })

  it('names the reached state instead of a percentage', () => {
    const tooltip = formatRateLimitTooltip({
      window: 'session',
      status: 'rejected',
      utilization: null,
      resetsAt: Date.now() + 1000,
    })
    expect(tooltip).toContain('reached')
    expect(tooltip).not.toMatch(/\d+%/)
  })
})

describe('getRateLimitItemColor', () => {
  it('is red once the limit is reached', () => {
    expect(getRateLimitItemColor({ status: 'rejected', utilization: null })).toBe(
      'hsl(0, 45%, 72%)',
    )
  })

  it('is amber at 75%', () => {
    expect(getRateLimitItemColor({ status: 'allowed_warning', utilization: 0.75 })).toBe(
      'hsl(38, 45%, 72%)',
    )
  })

  it('is red at 95% and beyond', () => {
    expect(getRateLimitItemColor({ status: 'allowed_warning', utilization: 0.95 })).toBe(
      'hsl(0, 45%, 72%)',
    )
    expect(getRateLimitItemColor({ status: 'allowed_warning', utilization: 1 })).toBe(
      'hsl(0, 45%, 72%)',
    )
  })
})
