/** Tests for useIsMobile hook. */

import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useIsMobile from './useIsMobile'

const MEDIA_QUERY = '(pointer: coarse) and (hover: none)'

describe('useIsMobile', () => {
  let listeners
  let mockMatches
  const originalMatchMedia = window.matchMedia
  const originalUserAgent = navigator.userAgent

  beforeEach(() => {
    listeners = []
    mockMatches = false

    window.matchMedia = vi.fn(query => ({
      matches: query === MEDIA_QUERY ? mockMatches : false,
      media: query,
      addEventListener: vi.fn((event, handler) => {
        listeners.push({ event, handler })
      }),
      removeEventListener: vi.fn((_event, handler) => {
        listeners = listeners.filter(l => l.handler !== handler)
      }),
    }))

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      configurable: true,
    })
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    })
  })

  it('returns false on desktop (no touch, no mobile UA)', () => {
    mockMatches = false
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)
  })

  it('queries pointer: coarse + hover: none for input modality', () => {
    renderHook(() => useIsMobile())
    expect(window.matchMedia).toHaveBeenCalledWith(MEDIA_QUERY)
  })

  it('returns true when touch-primary modality matches', () => {
    mockMatches = true
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })

  it('returns true via UA fallback when modality query is false', () => {
    mockMatches = false
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    })

    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })

  it('returns true via UA fallback for Android UA', () => {
    mockMatches = false
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      configurable: true,
    })

    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })

  it('subscribes to change events on mount', () => {
    renderHook(() => useIsMobile())

    expect(listeners.length).toBeGreaterThan(0)
    expect(listeners[0].event).toBe('change')
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useIsMobile())

    expect(listeners).toHaveLength(1)

    unmount()

    expect(listeners).toHaveLength(0)
  })

  it('updates when modality change event fires', () => {
    mockMatches = false
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)

    mockMatches = true
    act(() => {
      listeners[0].handler({ matches: true })
    })

    expect(result.current).toBe(true)
  })
})
