/** Tests for useRateLimitStatus - server-owned plan-limit entries, in-session or pre-session. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RATE_LIMITS_STORAGE_KEY } from '../../../config/storage'
import { RATE_LIMIT_SWEEP_INTERVAL_MS } from '../../../config/timing'

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: vi.fn(),
}))

vi.mock('../../../hooks/useSessionDefaults', () => ({
  default: vi.fn(),
}))

import { useSessionData } from '../../../context/SessionDataContext'
import useSessionDefaults from '../../../hooks/useSessionDefaults'
import useRateLimitStatus from './useRateLimitStatus'

function payload(rateLimitType, status, utilization, resetsAt = null) {
  return { rate_limit_type: rateLimitType, status, utilization, resets_at: resetsAt }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useRateLimitStatus', () => {
  it('derives live entries from sessionData.rateLimits, session before weekly', () => {
    useSessionData.mockReturnValue({
      rateLimits: [
        payload('seven_day', 'allowed_warning', 0.91),
        payload('five_hour', 'allowed_warning', 0.86),
      ],
    })
    useSessionDefaults.mockReturnValue(null)

    const { result } = renderHook(() => useRateLimitStatus())

    expect(result.current.map(e => e.window)).toEqual(['session', 'weekly'])
    expect(result.current[0].utilization).toBe(0.86)
  })

  it('falls back to sessionDefaults.rate_limits when no session is attached', () => {
    useSessionData.mockReturnValue({ rateLimits: null })
    useSessionDefaults.mockReturnValue({
      rate_limits: [payload('seven_day', 'allowed_warning', 0.82)],
    })

    const { result } = renderHook(() => useRateLimitStatus())

    expect(result.current).toHaveLength(1)
    expect(result.current[0].window).toBe('weekly')
  })

  it('prefers sessionData over sessionDefaults when both are present', () => {
    useSessionData.mockReturnValue({ rateLimits: [payload('five_hour', 'allowed_warning', 0.5)] })
    useSessionDefaults.mockReturnValue({
      rate_limits: [payload('five_hour', 'allowed_warning', 0.99)],
    })

    const { result } = renderHook(() => useRateLimitStatus())

    expect(result.current[0].utilization).toBe(0.5)
  })

  it('returns nothing before any usage is known', () => {
    useSessionData.mockReturnValue({ rateLimits: null })
    useSessionDefaults.mockReturnValue(null)

    const { result } = renderHook(() => useRateLimitStatus())

    expect(result.current).toEqual([])
  })

  it('drops an entry whose window is unmapped (e.g. seven_day_opus)', () => {
    useSessionData.mockReturnValue({
      rateLimits: [payload('seven_day_opus', 'allowed_warning', 0.5)],
    })
    useSessionDefaults.mockReturnValue(null)

    const { result } = renderHook(() => useRateLimitStatus())

    expect(result.current).toEqual([])
  })

  it('filters out an entry once its reset time has already passed', () => {
    useSessionData.mockReturnValue({
      rateLimits: [
        payload('five_hour', 'allowed_warning', 0.9, Math.floor(Date.now() / 1000) - 10),
      ],
    })
    useSessionDefaults.mockReturnValue(null)

    const { result } = renderHook(() => useRateLimitStatus())

    expect(result.current).toEqual([])
  })

  describe('expiry sweep', () => {
    beforeEach(() => vi.useFakeTimers())

    it('clears an entry on its own once the sweep tick crosses its reset time', () => {
      const resetsAt = Math.floor(Date.now() / 1000) + 1
      useSessionData.mockReturnValue({
        rateLimits: [payload('five_hour', 'allowed_warning', 0.9, resetsAt)],
      })
      useSessionDefaults.mockReturnValue(null)

      const { result } = renderHook(() => useRateLimitStatus())
      expect(result.current).toHaveLength(1)

      act(() => {
        vi.setSystemTime(Date.now() + 2000)
        vi.advanceTimersByTime(RATE_LIMIT_SWEEP_INTERVAL_MS)
      })

      expect(result.current).toEqual([])
    })
  })

  it('removes the browser-global record on mount', () => {
    localStorage.setItem(RATE_LIMITS_STORAGE_KEY, JSON.stringify({ weekly: { window: 'weekly' } }))
    useSessionData.mockReturnValue({ rateLimits: null })
    useSessionDefaults.mockReturnValue(null)

    renderHook(() => useRateLimitStatus())

    expect(localStorage.getItem(RATE_LIMITS_STORAGE_KEY)).toBeNull()
  })
})
