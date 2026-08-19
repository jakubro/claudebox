/** Tests for useTerminalVirtualizer - windowed terminal column entries. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useTerminalVirtualizer from './useTerminalVirtualizer'

/** A ref to a detached div reporting fixed dimensions - jsdom lays nothing out on its own. */
function sizedRef({ width = 900, height = 800 } = {}) {
  const el = document.createElement('div')
  for (const [prop, value] of Object.entries({
    clientHeight: height,
    clientWidth: width,
    offsetHeight: height,
    offsetWidth: width,
  })) {
    Object.defineProperty(el, prop, { value, configurable: true })
  }

  return { current: el }
}

function entry(id, overrides = {}) {
  return {
    id,
    turnId: `t-${id}`,
    command: `echo ${id}`,
    description: null,
    result: { content: `output ${id}`, is_error: false },
    ...overrides,
  }
}

describe('useTerminalVirtualizer', () => {
  it('windows a long entry list rather than mounting everything', () => {
    const entries = Array.from({ length: 400 }, (_, i) => entry(`e${i}`))
    // Refs built once, outside the render callback - renderHook re-invokes that callback on
    // every internal state update, and a fresh ref object each pass never converges.
    const containerRef = sizedRef()
    const listRef = sizedRef()

    const { result } = renderHook(() => useTerminalVirtualizer({ containerRef, listRef, entries }))

    expect(result.current.windowed).toBe(true)
    expect(result.current.virtualItems.length).toBeGreaterThan(0)
    expect(result.current.virtualItems.length).toBeLessThan(60)
  })

  it('reports unwindowed when the container has no measurable viewport', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(`e${i}`))
    const containerRef = { current: document.createElement('div') }
    const listRef = { current: document.createElement('div') }

    const { result } = renderHook(() => useTerminalVirtualizer({ containerRef, listRef, entries }))

    expect(result.current.windowed).toBe(false)
  })

  it('is windowed with zero entries', () => {
    const containerRef = sizedRef()
    const listRef = sizedRef()

    const { result } = renderHook(() =>
      useTerminalVirtualizer({ containerRef, listRef, entries: [] }),
    )

    expect(result.current.windowed).toBe(true)
    expect(result.current.virtualItems).toEqual([])
  })
})
