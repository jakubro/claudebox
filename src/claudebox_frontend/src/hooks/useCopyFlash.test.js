/** Tests for useCopyFlash hook. */

import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useCopyFlash from './useCopyFlash'

const DURATION = 500

describe('useCopyFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    navigator.clipboard = { writeText: vi.fn() }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flashes while copied, then resets after the duration', () => {
    const { result } = renderHook(() => useCopyFlash({ durationMs: DURATION }))

    act(() => result.current[1]('a path'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('a path')
    expect(result.current[0]).toBe(true)

    act(() => vi.advanceTimersByTime(DURATION))
    expect(result.current[0]).toBe(false)
  })

  it('ignores empty text', () => {
    const { result } = renderHook(() => useCopyFlash({ durationMs: DURATION }))

    act(() => result.current[1](''))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(result.current[0]).toBe(false)
  })

  it('leaves no pending reset behind when the component unmounts', () => {
    const { result, unmount } = renderHook(() => useCopyFlash({ durationMs: DURATION }))

    act(() => result.current[1]('a path'))
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts the reset rather than stacking one per copy', () => {
    const { result } = renderHook(() => useCopyFlash({ durationMs: DURATION }))

    act(() => result.current[1]('first'))
    act(() => vi.advanceTimersByTime(DURATION - 100))
    act(() => result.current[1]('second'))
    expect(vi.getTimerCount()).toBe(1)

    // The first copy's window has passed by now; the flash follows the second one instead.
    act(() => vi.advanceTimersByTime(100))
    expect(result.current[0]).toBe(true)

    act(() => vi.advanceTimersByTime(DURATION))
    expect(result.current[0]).toBe(false)
  })
})
