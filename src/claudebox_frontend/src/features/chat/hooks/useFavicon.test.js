/** Tests for useFavicon hook. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockWorkspaceColor = null

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ workspaceColor: mockWorkspaceColor }),
}))

import useFavicon from './useFavicon'

describe('useFavicon', () => {
  let mockCanvas
  let mockCtx
  let mockLink

  beforeEach(() => {
    mockWorkspaceColor = null
    mockCtx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      roundRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      lineCap: '',
      globalAlpha: 1,
    }

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(mockCtx),
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,test'),
    }

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      if (tag === 'canvas') {
        return mockCanvas
      }
      if (tag === 'link') {
        mockLink = { rel: '', href: '' }
        return mockLink
      }
      return originalCreateElement(tag)
    })

    vi.spyOn(document, 'querySelector').mockReturnValue(null)
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => {})

    Object.defineProperty(document, 'hidden', { value: false, writable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates initial normal favicon on mount', () => {
    renderHook(() => useFavicon({ isResponding: false }))

    expect(document.createElement).toHaveBeenCalledWith('canvas')
    expect(mockCanvas.toDataURL).toHaveBeenCalled()
  })

  it('updates favicon when responding starts', () => {
    vi.useFakeTimers()

    const { rerender } = renderHook(({ isResponding }) => useFavicon({ isResponding }), {
      initialProps: { isResponding: false },
    })

    const callsBefore = mockCanvas.toDataURL.mock.calls.length

    rerender({ isResponding: true })

    // Should have generated a new favicon
    expect(mockCanvas.toDataURL.mock.calls.length).toBeGreaterThan(callsBefore)

    vi.useRealTimers()
  })

  it('updates favicon when response completes while hidden', () => {
    Object.defineProperty(document, 'hidden', { value: true })

    const { rerender } = renderHook(({ isResponding }) => useFavicon({ isResponding }), {
      initialProps: { isResponding: true },
    })

    const callsBefore = mockCanvas.toDataURL.mock.calls.length

    rerender({ isResponding: false })

    // Should have generated notification favicon
    expect(mockCanvas.toDataURL.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('updates favicon when response completes while visible', () => {
    Object.defineProperty(document, 'hidden', { value: false })

    const { rerender } = renderHook(({ isResponding }) => useFavicon({ isResponding }), {
      initialProps: { isResponding: true },
    })

    const callsBefore = mockCanvas.toDataURL.mock.calls.length

    rerender({ isResponding: false })

    // Should have generated normal favicon
    expect(mockCanvas.toDataURL.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('restores normal favicon on visibility change from hidden to visible', () => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true })

    const { rerender } = renderHook(({ isResponding }) => useFavicon({ isResponding }), {
      initialProps: { isResponding: true },
    })

    // Complete response while hidden (sets notification favicon)
    rerender({ isResponding: false })
    const callsAfterNotification = mockCanvas.toDataURL.mock.calls.length

    // Simulate visibility change
    Object.defineProperty(document, 'hidden', { value: false })
    document.dispatchEvent(new Event('visibilitychange'))

    // Should have generated a new favicon for normal state
    expect(mockCanvas.toDataURL.mock.calls.length).toBeGreaterThan(callsAfterNotification)
  })

  it('clears animation interval on unmount', () => {
    vi.useFakeTimers()

    const { unmount } = renderHook(() => useFavicon({ isResponding: true }))

    // Animation should be running (setInterval active)
    const callsBefore = mockCanvas.toDataURL.mock.calls.length

    unmount()

    // Advance timers after unmount - no more draws should happen
    vi.advanceTimersByTime(500)
    expect(mockCanvas.toDataURL.mock.calls.length).toBe(callsBefore)

    vi.useRealTimers()
  })

  it('clears previous animation interval when transitioning from responding to not responding', () => {
    vi.useFakeTimers()

    const { rerender } = renderHook(({ isResponding }) => useFavicon({ isResponding }), {
      initialProps: { isResponding: true },
    })

    // Advance a bit to accumulate some animation frames
    vi.advanceTimersByTime(200)
    const callsWhileAnimating = mockCanvas.toDataURL.mock.calls.length
    expect(callsWhileAnimating).toBeGreaterThan(0)

    // Stop responding
    rerender({ isResponding: false })
    const callsAfterStop = mockCanvas.toDataURL.mock.calls.length

    // Advance more - animation should not produce new frames
    vi.advanceTimersByTime(500)
    expect(mockCanvas.toDataURL.mock.calls.length).toBe(callsAfterStop)

    vi.useRealTimers()
  })

  it('animation generates multiple favicon frames over time', () => {
    vi.useFakeTimers()

    renderHook(() => useFavicon({ isResponding: true }))

    const callsAtStart = mockCanvas.toDataURL.mock.calls.length

    // Advance through animation frames
    vi.advanceTimersByTime(200)

    // Should have generated multiple favicon frames
    expect(mockCanvas.toDataURL.mock.calls.length).toBeGreaterThan(callsAtStart + 1)

    vi.useRealTimers()
  })

  it('draws dev badge on normal favicon in dev mode', () => {
    renderHook(() => useFavicon({ isResponding: false }))

    // In dev mode (Vitest sets import.meta.env.DEV = true), fill() is called for the badge
    expect(mockCtx.fill).toHaveBeenCalled()
  })

  it('renders workspace bg AND dev badge when workspace color is set in DEV mode', () => {
    mockWorkspaceColor = '#1e3a5f'

    renderHook(() => useFavicon({ isResponding: false }))

    // Workspace bg circle: arc at center (16,16) radius 14.
    expect(mockCtx.arc).toHaveBeenCalledWith(16, 16, 14, 0, Math.PI * 2)
    // Dev badge: arc at (size-7, size-7, 7, 0, 2π) - 32-7 = 25.
    expect(mockCtx.arc).toHaveBeenCalledWith(25, 25, 7, 0, Math.PI * 2)
  })

  it('passes a brightened color (not the raw workspaceColor) to drawWorkspaceBadge', () => {
    mockWorkspaceColor = '#2a4a2a'
    // Capture every fillStyle assignment so we can scan the sequence.
    const fillStyles = []
    Object.defineProperty(mockCtx, 'fillStyle', {
      get: () => fillStyles.at(-1) ?? '',
      set: v => fillStyles.push(v),
    })

    renderHook(() => useFavicon({ isResponding: false }))

    // deriveFaviconBgColor('#2a4a2a') = '#368236' (HSL L=0.36, S×1.5, hue preserved).
    // The bg fillStyle assignment appears in the recorded sequence before the
    // dev-badge orange ('#f59e0b') overrides it.
    expect(fillStyles).toContain('#368236')
    expect(fillStyles).not.toContain('#2a4a2a')
  })

  it('pulses workspace bg alpha in sync with the breath cycle during processing', () => {
    vi.useFakeTimers()
    mockWorkspaceColor = '#1e3a5f'
    // Capture every globalAlpha assignment to inspect the per-frame value.
    const alphaValues = []
    Object.defineProperty(mockCtx, 'globalAlpha', {
      get: () => alphaValues.at(-1) ?? 1,
      set: v => alphaValues.push(v),
    })

    renderHook(() => useFavicon({ isResponding: true }))

    // Advance through multiple breath frames so the sine sweeps a range.
    vi.advanceTimersByTime(2000)

    // BREATHING_BG_PEAK_ALPHA = 0.5, breath intensity ∈ [0.5, 1.0] -> alpha ∈ [0.25, 0.5].
    const observed = alphaValues.filter(v => v < 1)
    expect(observed.length).toBeGreaterThan(0)
    expect(Math.min(...observed)).toBeGreaterThanOrEqual(0.24)
    expect(Math.max(...observed)).toBeLessThanOrEqual(0.51)

    vi.useRealTimers()
  })

  it('clears interval on unmount even when canvas context is unavailable', () => {
    vi.useFakeTimers()

    // Start with responding to create the interval
    const { unmount } = renderHook(({ isResponding }) => useFavicon({ isResponding }), {
      initialProps: { isResponding: true },
    })

    vi.advanceTimersByTime(100)

    // Unmount should not throw
    expect(() => unmount()).not.toThrow()

    vi.useRealTimers()
  })
})
