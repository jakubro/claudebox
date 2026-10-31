/** Tests for useTurnVirtualizer - collapse flips of turns the window has not mounted. */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createRowSizeStore } from '../utils/rowSizeStore'
import useTurnVirtualizer from './useTurnVirtualizer'

/** A detached div reporting fixed dimensions - jsdom lays nothing out on its own. */
function sizedEl({ width = 900, height = 800 } = {}) {
  const el = document.createElement('div')
  for (const [prop, value] of Object.entries({
    clientHeight: height,
    clientWidth: width,
    offsetHeight: height,
    offsetWidth: width,
  })) {
    Object.defineProperty(el, prop, { value, configurable: true })
  }

  return el
}

function rowEl(index, height) {
  const el = document.createElement('div')
  el.dataset.index = String(index)
  el.getBoundingClientRect = () => ({
    height,
    width: 900,
    top: 0,
    left: 0,
    bottom: height,
    right: 900,
  })

  return el
}

const longText = { type: 'assistant', subtype: 'text', content: 'x'.repeat(3000) }
const turns = ['a', 'b', 'c'].map(id => ({
  turn_id: id,
  userMessage: 'hi',
  events: [longText],
  attachments: null,
}))

function renderVirtualizer(rowSizes = createRowSizeStore()) {
  const messagesEl = sizedEl()
  const listRef = { current: sizedEl() }
  const hook = renderHook(
    ({ collapsedTurnIds, list = turns }) =>
      useTurnVirtualizer({ messagesEl, listRef, turns: list, collapsedTurnIds, rowSizes }),
    { initialProps: { collapsedTurnIds: new Set() } },
  )

  return { ...hook, rowSizes }
}

const sizeOf = (result, index) => result.current.virtualizer.measurementsCache[index].size

function renderWithMountedRow() {
  const hook = renderVirtualizer()
  const mounted = rowEl(1, 640)
  document.body.appendChild(mounted)

  return { ...hook, mounted }
}

describe('useTurnVirtualizer', () => {
  it('resizes an unmounted turn to its collapsed estimate when it collapses', () => {
    const { result, rerender, rowSizes } = renderVirtualizer()
    const expanded = sizeOf(result, 1)

    rerender({ collapsedTurnIds: new Set(['b']) })

    expect(sizeOf(result, 1)).toBeLessThan(expanded)
    expect(rowSizes.get('b')).toBe(sizeOf(result, 1))
  })

  it('restores the size last measured in a state when an unmounted turn returns to it', () => {
    const { result, rerender, rowSizes, mounted } = renderWithMountedRow()
    act(() => {
      result.current.virtualizer.measureElement(mounted)
    })
    mounted.remove()
    expect(rowSizes.get('b')).toBe(640)

    rerender({ collapsedTurnIds: new Set(['b']) })
    expect(sizeOf(result, 1)).not.toBe(640)
    rerender({ collapsedTurnIds: new Set() })

    expect(sizeOf(result, 1)).toBe(640)
    expect(rowSizes.get('b')).toBe(640)
  })

  it('leaves turns whose state did not change at their size', () => {
    const { result, rerender } = renderVirtualizer()
    const mounted = rowEl(0, 555)
    document.body.appendChild(mounted)
    act(() => {
      result.current.virtualizer.measureElement(mounted)
    })
    mounted.remove()

    rerender({ collapsedTurnIds: new Set(['b']) })

    expect(sizeOf(result, 0)).toBe(555)
  })

  it('records a mounted turn at its collapsed height even if it unmounts before its observer reports', () => {
    const { result, rerender, rowSizes, mounted } = renderWithMountedRow()
    act(() => {
      result.current.virtualizer.measureElement(mounted)
    })

    mounted.getBoundingClientRect = () => ({ height: 120 })
    rerender({ collapsedTurnIds: new Set(['b']) })
    mounted.remove()

    expect(sizeOf(result, 1)).toBe(120)
    expect(rowSizes.get('b')).toBe(120)
  })

  it('records a real measurement even when it equals the estimate', () => {
    const { result, rerender, rowSizes, mounted } = renderWithMountedRow()
    act(() => {
      result.current.virtualizer.measureElement(mounted)
    })
    rerender({ collapsedTurnIds: new Set(['b']) })
    const collapsedEstimate = result.current.virtualizer.options.estimateSize(1)

    mounted.getBoundingClientRect = () => ({ height: collapsedEstimate })
    act(() => {
      result.current.virtualizer.measureElement(mounted)
    })

    expect(rowSizes.get('b')).toBe(collapsedEstimate)
    mounted.remove()
  })

  it('carries over the size the live turn was measured at when it joins the list', () => {
    const rowSizes = createRowSizeStore()
    const { result, rerender } = renderVirtualizer(rowSizes)
    const live = { turn_id: 'd', userMessage: 'hi', events: [longText], attachments: null }
    rowSizes.set('d', 777)

    rerender({ collapsedTurnIds: new Set(), list: [...turns, live] })

    expect(sizeOf(result, 3)).toBe(777)
  })
})
