/** Tests for useClaudeStatus hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useClaudeStatus from './useClaudeStatus'

describe('useClaudeStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fetches status on mount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: { indicator: 'none', description: 'All Systems Operational' },
        }),
    })

    const { result } = renderHook(() => useClaudeStatus())

    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.indicator).toBe('none')
    expect(result.current.description).toBe('All Systems Operational')
    expect(result.current.error).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })

  it('handles fetch errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useClaudeStatus())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.error).toBe(true)
    expect(result.current.isLoading).toBe(false)
  })

  it('polls every 60 seconds', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: { indicator: 'none', description: 'All Systems Operational' },
        }),
    })

    renderHook(() => useClaudeStatus())

    // Initial fetch
    expect(fetch).toHaveBeenCalledTimes(1)

    // Advance 60 seconds and flush microtasks
    await act(async () => {
      vi.advanceTimersByTime(60000)
      await Promise.resolve()
    })

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('cleans up interval on unmount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: { indicator: 'none' } }),
    })

    const { unmount } = renderHook(() => useClaudeStatus())

    await act(async () => {
      await Promise.resolve()
    })

    const callCount = fetch.mock.calls.length
    unmount()

    // Advance time after unmount - should not trigger more fetches
    vi.advanceTimersByTime(120000)

    expect(fetch).toHaveBeenCalledTimes(callCount)
  })

  it('handles HTTP errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    const { result } = renderHook(() => useClaudeStatus())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.error).toBe(true)
  })

  it('appends incident name for non-green statuses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: { indicator: 'minor', description: 'Partially Degraded Service' },
          incidents: [{ name: 'Elevated errors on Claude Opus 4.5' }],
        }),
    })

    const { result } = renderHook(() => useClaudeStatus())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.indicator).toBe('minor')
    expect(result.current.description).toBe(
      'Partially Degraded Service — Elevated errors on Claude Opus 4.5',
    )
  })

  it('does not append incident for green status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: { indicator: 'none', description: 'All Systems Operational' },
          incidents: [{ name: 'Should not appear' }],
        }),
    })

    const { result } = renderHook(() => useClaudeStatus())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.description).toBe('All Systems Operational')
  })
})
