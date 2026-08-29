/** Tests for useColumnMinimapData - overview bars, getters, and the landing transition. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useColumnMinimapData } from './useColumnMinimapData'

function render(overrides = {}) {
  const buildBars = vi.fn((items, cacheRef) =>
    items.map(item => {
      cacheRef.current.set(item.id, true)
      return { id: item.id, height: item.height ?? 10, width: 8, status: 'passed' }
    }),
  )
  const args = {
    items: [],
    buildBars,
    autoScrollEnabledRef: { current: true },
    markUserIntent: vi.fn(),
    markReturnedToBottom: vi.fn(),
    ...overrides,
  }
  return { ...renderHook(() => useColumnMinimapData(args)), args }
}

describe('useColumnMinimapData', () => {
  it('builds bars via the caller-supplied builder', () => {
    const { result } = render({ items: [{ id: 'a' }, { id: 'b' }] })
    expect(result.current.bars).toHaveLength(2)
  })

  it('shares its metrics cache ref with the builder, populated on the first call', () => {
    const { result } = render({ items: [{ id: 'a' }] })
    expect(result.current.metricsCacheRef.current.has('a')).toBe(true)
  })

  it('reads the autoscroll owner ref through the getter', () => {
    const autoScrollEnabledRef = { current: false }
    const { result } = render({ autoScrollEnabledRef })
    expect(result.current.getAutoScrollEnabled()).toBe(false)

    autoScrollEnabledRef.current = true
    expect(result.current.getAutoScrollEnabled()).toBe(true)
  })

  it('sums bar heights for the logical scroll height', () => {
    const { result } = render({
      items: [
        { id: 'a', height: 30 },
        { id: 'b', height: 12 },
      ],
    })
    const total = result.current.bars.reduce((sum, b) => sum + b.height, 0)
    expect(result.current.getLogicalScrollHeight()).toBe(total)
  })

  it('marks a return to the bottom when a landing is at the bottom', () => {
    const markReturnedToBottom = vi.fn()
    const markUserIntent = vi.fn()
    const { result } = render({ markReturnedToBottom, markUserIntent })

    result.current.handleMinimapLanding(true)

    expect(markReturnedToBottom).toHaveBeenCalledOnce()
    expect(markUserIntent).not.toHaveBeenCalled()
  })

  it('marks user intent when a landing is off the bottom', () => {
    const markReturnedToBottom = vi.fn()
    const markUserIntent = vi.fn()
    const { result } = render({ markReturnedToBottom, markUserIntent })

    result.current.handleMinimapLanding(false)

    expect(markUserIntent).toHaveBeenCalledOnce()
    expect(markReturnedToBottom).not.toHaveBeenCalled()
  })

  it('recomputes bars only when items or the builder change, not on every render', () => {
    const buildBars = vi.fn((items, cacheRef) =>
      items.map(item => {
        cacheRef.current.set(item.id, true)
        return { id: item.id, height: 10, width: 8, status: 'passed' }
      }),
    )
    const items = [{ id: 'a' }]
    const { rerender } = renderHook(
      props =>
        useColumnMinimapData({
          items: props.items,
          buildBars,
          autoScrollEnabledRef: { current: true },
          markUserIntent: vi.fn(),
          markReturnedToBottom: vi.fn(),
        }),
      { initialProps: { items } },
    )
    expect(buildBars).toHaveBeenCalledTimes(1)

    rerender({ items })
    expect(buildBars).toHaveBeenCalledTimes(1)

    rerender({ items: [...items] })
    expect(buildBars).toHaveBeenCalledTimes(2)
  })
})
