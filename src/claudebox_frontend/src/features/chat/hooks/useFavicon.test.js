/** Tests for useFavicon hook. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockWorkspaceColor = null

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ workspaceColor: mockWorkspaceColor }),
}))

import { WAITING_ARC_ALPHA } from '../utils/favicon'
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

    expect(mockCanvas.toDataURL.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('updates favicon when response completes while visible', () => {
    Object.defineProperty(document, 'hidden', { value: false })

    const { rerender } = renderHook(({ isResponding }) => useFavicon({ isResponding }), {
      initialProps: { isResponding: true },
    })

    const callsBefore = mockCanvas.toDataURL.mock.calls.length

    rerender({ isResponding: false })

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

    Object.defineProperty(document, 'hidden', { value: false })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mockCanvas.toDataURL.mock.calls.length).toBeGreaterThan(callsAfterNotification)
  })

  it.each([
    ['responding', { isResponding: true }],
    ['waiting on background work', { isResponding: false, isWaiting: true }],
  ])('sets the icon once while %s and never again as time passes', (_label, props) => {
    vi.useFakeTimers()
    const { rerender } = renderHook(p => useFavicon(p), { initialProps: { isResponding: false } })
    const before = mockCanvas.toDataURL.mock.calls.length

    rerender(props)
    vi.advanceTimersByTime(5000)

    expect(mockCanvas.toDataURL.mock.calls.length).toBe(before + 1)
    vi.useRealTimers()
  })

  it('redraws once on each state change', () => {
    const { rerender } = renderHook(p => useFavicon(p), { initialProps: { isResponding: false } })
    const before = mockCanvas.toDataURL.mock.calls.length

    rerender({ isResponding: true })
    rerender({ isResponding: false, isWaiting: true })
    rerender({ isResponding: false, isWaiting: false })

    expect(mockCanvas.toDataURL.mock.calls.length).toBe(before + 3)
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
    // Dev badge: arc at (size-7, size-7, 7, 0, Math.PI*2) - 32-7 = 25.
    expect(mockCtx.arc).toHaveBeenCalledWith(25, 25, 7, 0, Math.PI * 2)
  })

  it('passes a brightened color (not the raw workspaceColor) to drawWorkspaceBadge', () => {
    mockWorkspaceColor = '#2a4a2a'
    // Capture every fillStyle assignment so the sequence can be scanned.
    const fillStyles = []
    Object.defineProperty(mockCtx, 'fillStyle', {
      get: () => fillStyles.at(-1) ?? '',
      set: v => fillStyles.push(v),
    })

    renderHook(() => useFavicon({ isResponding: false }))

    // deriveFaviconBgColor('#2a4a2a') = '#368236' (HSL L=0.36, S x1.5, hue preserved); bg fillStyle
    // is assigned before the dev-badge orange ('#f59e0b') overrides it.
    expect(fillStyles).toContain('#368236')
    expect(fillStyles).not.toContain('#2a4a2a')
  })

  it('dims the workspace disc to half under the working arc', () => {
    mockWorkspaceColor = '#1e3a5f'
    const alphaValues = []
    Object.defineProperty(mockCtx, 'globalAlpha', {
      get: () => alphaValues.at(-1) ?? 1,
      set: v => alphaValues.push(v),
    })

    renderHook(() => useFavicon({ isResponding: true }))

    expect(alphaValues.filter(v => v < 1)).toEqual([0.5])
  })

  describe('needs-you state', () => {
    // Hex strokes the C-arc was painted with since the last reset, classified by hue.
    let strokes
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    const isRed = hex => {
      const [r, g, b] = rgb(hex)
      return r - g > 60 && Math.abs(g - b) < 20
    }
    const isOrange = hex => {
      const [r, g, b] = rgb(hex)
      return r - b > 100 && g - b > 50
    }

    beforeEach(() => {
      strokes = []
      Object.defineProperty(mockCtx, 'strokeStyle', {
        get: () => strokes.at(-1) ?? '',
        set: v => strokes.push(v),
      })
    })

    it.each([
      ['visible', false],
      ['hidden', true],
    ])('paints a red arc while %s and not responding', (_label, hidden) => {
      Object.defineProperty(document, 'hidden', { value: hidden, writable: true })

      renderHook(() => useFavicon({ isResponding: false, needsUser: true }))

      expect(strokes.length).toBeGreaterThan(0)
      expect(strokes.every(isRed)).toBe(true)
    })

    it('wins over orange when a turn ends while hidden', () => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true })
      const { rerender } = renderHook(props => useFavicon(props), {
        initialProps: { isResponding: true, needsUser: true },
      })
      strokes = []

      rerender({ isResponding: false, needsUser: true })

      expect(strokes.every(isRed)).toBe(true)
      expect(strokes.some(isOrange)).toBe(false)
    })

    it('shows the working arc while responding, then turns red when the turn ends', () => {
      const { rerender } = renderHook(props => useFavicon(props), {
        initialProps: { isResponding: true, needsUser: true },
      })

      expect(strokes.length).toBeGreaterThan(0)
      expect(strokes.some(isRed)).toBe(false)

      strokes = []
      rerender({ isResponding: false, needsUser: true })

      expect(strokes.every(isRed)).toBe(true)
    })

    it('turns red when needsUser arrives after the turn already ended', () => {
      const { rerender } = renderHook(props => useFavicon(props), {
        initialProps: { isResponding: false, needsUser: false },
      })
      strokes = []

      rerender({ isResponding: false, needsUser: true })

      expect(strokes.length).toBeGreaterThan(0)
      expect(strokes.every(isRed)).toBe(true)
    })

    it('stays red when the tab is focused', () => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true })
      renderHook(() => useFavicon({ isResponding: false, needsUser: true }))
      const draws = mockCanvas.toDataURL.mock.calls.length

      Object.defineProperty(document, 'hidden', { value: false })
      document.dispatchEvent(new Event('visibilitychange'))

      expect(mockCanvas.toDataURL.mock.calls.length).toBe(draws)
    })

    it('leaves red once the session stops needing the user', () => {
      const { rerender } = renderHook(props => useFavicon(props), {
        initialProps: { isResponding: false, needsUser: true },
      })
      strokes = []

      rerender({ isResponding: false, needsUser: false })

      expect(strokes.length).toBeGreaterThan(0)
      expect(strokes.some(isRed)).toBe(false)
    })

    it('dims the workspace disc under the red arc', () => {
      mockWorkspaceColor = '#1e3a5f'
      const alphas = []
      Object.defineProperty(mockCtx, 'globalAlpha', {
        get: () => alphas.at(-1) ?? 1,
        set: v => alphas.push(v),
      })

      renderHook(() => useFavicon({ isResponding: false, needsUser: true }))

      expect(alphas).toContain(0.5)
    })
  })

  describe('waiting on background work', () => {
    let strokes

    beforeEach(() => {
      vi.useFakeTimers()
      strokes = []
      mockCtx.stroke = vi.fn(() => {
        strokes.push({
          color: String(mockCtx.strokeStyle).toLowerCase(),
          alpha: mockCtx.globalAlpha,
        })
      })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const lastFrame = () => strokes.slice(-30).map(x => x.color)
    const channels = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16))
    const isOrange = hex => {
      const [r, g, b] = channels(hex)
      return r > 200 && g - b > 40
    }
    const isRed = hex => {
      const [r, g, b] = channels(hex)
      return r - g > 60 && Math.abs(g - b) < 10
    }
    const paintedOrange = () => strokes.some(x => isOrange(x.color))

    it('shows the arc dimmed, not orange, when a turn ends hidden with work still running', () => {
      document.hidden = true
      const { rerender } = renderHook(props => useFavicon(props), {
        initialProps: { isResponding: true, isWaiting: false },
      })
      const working = lastFrame()
      strokes = []

      rerender({ isResponding: false, isWaiting: true })

      expect(paintedOrange()).toBe(false)
      expect(strokes.map(x => x.color)).toEqual(working)
      expect(strokes.every(x => x.alpha > 0 && x.alpha < 1)).toBe(true)
    })

    it('shows red rather than waiting while the session needs the user', () => {
      renderHook(() => useFavicon({ isResponding: false, isWaiting: true, needsUser: true }))

      expect(strokes.some(x => isRed(x.color))).toBe(true)
      expect(strokes.some(x => x.alpha === WAITING_ARC_ALPHA)).toBe(false)
    })

    it('settles to normal, not orange, when the work ends without a turn', () => {
      document.hidden = true
      const { rerender } = renderHook(props => useFavicon(props), {
        initialProps: { isResponding: false, isWaiting: true },
      })
      strokes = []

      rerender({ isResponding: false, isWaiting: false })

      expect(paintedOrange()).toBe(false)
    })

    it('turns orange when the follow-up turn ends hidden with nothing left running', () => {
      document.hidden = true
      const { rerender } = renderHook(props => useFavicon(props), {
        initialProps: { isResponding: false, isWaiting: true },
      })
      rerender({ isResponding: true, isWaiting: false })
      strokes = []

      rerender({ isResponding: false, isWaiting: false })

      expect(paintedOrange()).toBe(true)
    })
  })
})
