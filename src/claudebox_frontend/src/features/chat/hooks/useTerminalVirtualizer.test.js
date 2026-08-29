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
    // Built once, outside the render callback - renderHook re-invokes that callback on every
    // internal state update, and a fresh element/ref each pass never converges.
    const containerEl = sizedRef().current
    const listRef = sizedRef()

    const { result } = renderHook(() => useTerminalVirtualizer({ containerEl, listRef, entries }))

    expect(result.current.windowed).toBe(true)
    expect(result.current.virtualItems.length).toBeGreaterThan(0)
    expect(result.current.virtualItems.length).toBeLessThan(60)
  })

  it('reports unwindowed when the container has no measurable viewport', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(`e${i}`))
    const containerEl = document.createElement('div')
    const listRef = { current: document.createElement('div') }

    const { result } = renderHook(() => useTerminalVirtualizer({ containerEl, listRef, entries }))

    expect(result.current.windowed).toBe(false)
  })

  it('is windowed with zero entries', () => {
    const containerEl = sizedRef().current
    const listRef = sizedRef()

    const { result } = renderHook(() =>
      useTerminalVirtualizer({ containerEl, listRef, entries: [] }),
    )

    expect(result.current.windowed).toBe(true)
    expect(result.current.virtualItems).toEqual([])
  })

  it('populates a caller-supplied metrics cache instead of a private one', () => {
    const entries = [entry('e0')]
    const containerEl = sizedRef().current
    const listRef = sizedRef()
    const metricsCacheRef = { current: new Map() }

    renderHook(() => useTerminalVirtualizer({ containerEl, listRef, entries, metricsCacheRef }))

    // estimateSize runs for the sole windowed entry, caching its metrics in the SUPPLIED ref -
    // proving a second reader handed the same ref would hit the cache rather than re-extracting.
    expect(metricsCacheRef.current.get('e0')).toMatchObject({ pending: false, isFailed: false })
  })
})
