/** Tests for useFloatingPanel hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useFloatingPanel from './useFloatingPanel'

const ACTIVE = ['sessions', 'todos']
const mockEl = top => ({
  getBoundingClientRect: () => ({ top, right: 32, left: 0, bottom: top + 32 }),
})

describe('useFloatingPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null state initially', () => {
    const { result } = renderHook(() => useFloatingPanel(true, ACTIVE))

    expect(result.current.hoveredPanelId).toBeNull()
    expect(result.current.anchorRect).toBeNull()
    expect(result.current.floatingPosition).toBeNull()
  })

  it('shows the panel after the hover-intent delay when maximized', () => {
    const { result } = renderHook(() => useFloatingPanel(true, ACTIVE))

    act(() => {
      result.current.handleIconEnter('sessions', mockEl(100), 'left')
    })

    // Maximized now waits out the shared hover-intent delay (350 ms) like every
    // other state - no instant preview.
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.hoveredPanelId).toBeNull()

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current.hoveredPanelId).toBe('sessions')
    expect(result.current.floatingPosition).toBe('left')
  })

  it('skips icon enter when not maximized AND panel is currently visible', () => {
    const { result } = renderHook(() => useFloatingPanel(false, ACTIVE))

    act(() => {
      // 'sessions' is in ACTIVE - visible panel, no preview should fire.
      result.current.handleIconEnter('sessions', mockEl(0), 'left')
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(result.current.hoveredPanelId).toBeNull()
  })

  it('fires preview after hover-intent delay when not maximized AND panel is closed', () => {
    const { result } = renderHook(() => useFloatingPanel(false, ACTIVE))

    act(() => {
      // 'bookmarks' is NOT in ACTIVE - closed panel; preview should fire after the
      // hover-intent delay (350 ms).
      result.current.handleIconEnter('bookmarks', mockEl(50), 'right')
    })

    // Before the delay elapses - no preview yet.
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.hoveredPanelId).toBeNull()

    // After the delay - preview shown.
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current.hoveredPanelId).toBe('bookmarks')
  })

  it('cancels the pending hover-intent if cursor leaves before delay elapses', () => {
    const { result } = renderHook(() => useFloatingPanel(false, ACTIVE))

    act(() => {
      result.current.handleIconEnter('bookmarks', mockEl(50), 'right')
    })

    act(() => {
      vi.advanceTimersByTime(100)
      result.current.handleIconLeave()
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(result.current.hoveredPanelId).toBeNull()
  })

  it('dismisses after leave timer expires (maximized branch)', () => {
    const { result } = renderHook(() => useFloatingPanel(true, ACTIVE))

    act(() => {
      result.current.handleIconEnter('todos', mockEl(0), 'right')
    })
    // Maximized waits the hover-intent delay before showing.
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(result.current.hoveredPanelId).toBe('todos')

    act(() => {
      result.current.handleIconLeave()
    })
    // Still visible during the dismiss grace period.
    expect(result.current.hoveredPanelId).toBe('todos')

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current.hoveredPanelId).toBeNull()
  })

  it('cancels the dismiss timer when cursor enters the floating panel', () => {
    const { result } = renderHook(() => useFloatingPanel(true, ACTIVE))

    act(() => {
      result.current.handleIconEnter('todos', mockEl(0), 'right')
    })
    act(() => {
      vi.advanceTimersByTime(350)
    })

    act(() => {
      result.current.handleIconLeave()
    })

    // Cursor enters the floating panel before the dismiss timer fires.
    act(() => {
      vi.advanceTimersByTime(50)
      result.current.handlePanelEnter()
    })

    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Still visible - dismiss timer was cancelled by the panel-enter.
    expect(result.current.hoveredPanelId).toBe('todos')
  })

  it('dismisses immediately on dismiss()', () => {
    const { result } = renderHook(() => useFloatingPanel(true, ACTIVE))

    act(() => {
      result.current.handleIconEnter('sessions', mockEl(0), 'left')
    })
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(result.current.hoveredPanelId).toBe('sessions')

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.hoveredPanelId).toBeNull()
  })

  it('clears state when isMaximized becomes false', () => {
    const { result, rerender } = renderHook(({ max }) => useFloatingPanel(max, ACTIVE), {
      initialProps: { max: true },
    })

    act(() => {
      result.current.handleIconEnter('sessions', mockEl(0), 'left')
    })
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(result.current.hoveredPanelId).toBe('sessions')

    rerender({ max: false })

    expect(result.current.hoveredPanelId).toBeNull()
  })

  it('skips the intent-timer fire if the panel turned active during the 350 ms window', () => {
    const { result, rerender } = renderHook(({ active }) => useFloatingPanel(false, active), {
      initialProps: { active: ACTIVE },
    })

    act(() => {
      result.current.handleIconEnter('bookmarks', mockEl(50), 'right')
    })

    // Panel toggles active before the 350 ms intent timer fires (e.g., the
    // click that landed the hover also toggled the panel open in dockview).
    rerender({ active: [...ACTIVE, 'bookmarks'] })

    act(() => {
      vi.advanceTimersByTime(350)
    })
    // No preview - the setTimeout body re-checks activePanels at fire-time.
    expect(result.current.hoveredPanelId).toBeNull()
  })

  it('dismisses an active preview when its panel becomes active (not-maximized)', () => {
    const { result, rerender } = renderHook(({ active }) => useFloatingPanel(false, active), {
      initialProps: { active: ACTIVE },
    })

    // Intent timer elapses -> preview visible.
    act(() => {
      result.current.handleIconEnter('bookmarks', mockEl(50), 'right')
      vi.advanceTimersByTime(350)
    })
    expect(result.current.hoveredPanelId).toBe('bookmarks')

    // Panel turns active afterwards (keyboard shortcut, programmatic open).
    rerender({ active: [...ACTIVE, 'bookmarks'] })
    expect(result.current.hoveredPanelId).toBeNull()
  })

  it('keeps the preview when a panel becomes active under the maximized branch', () => {
    // Maximized branch previews every icon - currently-visible included - so
    // the dismiss-on-active rule that applies when not maximized must NOT fire.
    const { result, rerender } = renderHook(({ active }) => useFloatingPanel(true, active), {
      initialProps: { active: ACTIVE },
    })

    act(() => {
      result.current.handleIconEnter('bookmarks', mockEl(50), 'right')
    })
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(result.current.hoveredPanelId).toBe('bookmarks')

    rerender({ active: [...ACTIVE, 'bookmarks'] })
    expect(result.current.hoveredPanelId).toBe('bookmarks')
  })

  it('switches panel and starts a fresh intent timer when hovering a different closed icon', () => {
    const { result } = renderHook(() => useFloatingPanel(false, ACTIVE))

    act(() => {
      result.current.handleIconEnter('bookmarks', mockEl(50), 'right')
    })

    // Switch to a different closed-panel icon before the first intent fires.
    act(() => {
      vi.advanceTimersByTime(100)
      result.current.handleIconEnter('boards', mockEl(80), 'right')
    })

    // The original intent should NOT fire - the second hover restarts the timer.
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.hoveredPanelId).toBeNull()

    // After the fresh delay completes, the new panel's preview fires.
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current.hoveredPanelId).toBe('boards')
  })
})
