/** Tests for useNow. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useNow from './useNow'

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances on its interval', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { result } = renderHook(() => useNow(30_000))
    expect(result.current).toBe(1_000_000)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(result.current).toBe(1_030_000)
  })
})
