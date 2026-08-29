/** Tests for useWorkJump hook - the case that pays for it is skipping prose-only turns. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import useWorkJump from './useWorkJump'

function toolTurn(id) {
  return {
    turn_id: id,
    events: [{ type: 'assistant', subtype: 'tool_use', content: 'Bash', tool_use_id: id }],
  }
}

function proseTurn(id) {
  return { turn_id: id, events: [{ type: 'assistant', subtype: 'text', content: 'hi' }] }
}

/** Build a scroll container plus a virtualizer stub covering every entry. */
function createHarness({
  scrollTop = 0,
  scrollHeight = 100000,
  clientHeight = 500,
  measurements = [],
} = {}) {
  const container = document.createElement('div')
  container.scrollTop = scrollTop
  container.getBoundingClientRect = () => ({ top: 0 })
  Object.defineProperty(container, 'scrollHeight', { get: () => scrollHeight })
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight })
  document.body.appendChild(container)

  const virtualizer = {
    measurementsCache: measurements.map((m, index) => ({
      index,
      start: m.start,
      size: m.size ?? 100,
    })),
    scrollToIndex: vi.fn(),
  }

  return {
    container,
    containerRef: { current: container },
    virtualizerRef: { current: virtualizer },
    scrollToIndex: virtualizer.scrollToIndex,
  }
}

function renderJump(h, { turns, onIntent, onBottom, onProgrammatic } = {}) {
  return renderHook(() =>
    useWorkJump({
      containerRef: h.containerRef,
      virtualizerRef: h.virtualizerRef,
      turns,
      mode: TurnRoutingMode.ALL_TOOLS,
      markProgrammaticScroll: onProgrammatic,
      markUserIntent: onIntent,
      markReturnedToBottom: onBottom,
    }),
  )
}

describe('useWorkJump', () => {
  let rafCallbacks = []

  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('exposes only stepPrev/stepNext - no jumpTop/jumpBottom, like the terminal', () => {
    const h = createHarness()
    const { result } = renderJump(h, { turns: [] })
    expect(Object.keys(result.current).sort()).toEqual(['stepNext', 'stepPrev'])
  })

  it('steps to the last working turn above the viewport', () => {
    const turns = [toolTurn('t0'), toolTurn('t1'), toolTurn('t2')]
    const h = createHarness({
      scrollTop: 900,
      measurements: [{ start: 0 }, { start: 400 }, { start: 800 }],
    })
    const { result } = renderJump(h, { turns })

    act(() => result.current.stepPrev())

    expect(h.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
  })

  it('the case that pays for it: never lands on a prose-only turn', () => {
    // t1 sits between the two tool turns and routed nothing away - it must never be a step target.
    const turns = [toolTurn('t0'), proseTurn('t1'), toolTurn('t2')]
    const h = createHarness({
      scrollTop: 0,
      measurements: [{ start: 0 }, { start: 400 }, { start: 800 }],
    })
    const { result } = renderJump(h, { turns })

    act(() => result.current.stepNext())

    // Skips index 1 (prose) and lands directly on index 2, the next working turn.
    expect(h.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
  })

  it('stepping past a run of prose-only turns reaches the next working one, not just the nearest', () => {
    const turns = [
      toolTurn('t0'),
      proseTurn('t1'),
      proseTurn('t2'),
      proseTurn('t3'),
      toolTurn('t4'),
    ]
    const h = createHarness({
      scrollTop: 0,
      measurements: [{ start: 0 }, { start: 200 }, { start: 400 }, { start: 600 }, { start: 800 }],
    })
    const { result } = renderJump(h, { turns })

    act(() => result.current.stepNext())

    expect(h.scrollToIndex).toHaveBeenCalledWith(4, { align: 'start' })
  })

  it('settles at the very top when nothing working starts above the viewport', () => {
    const turns = [toolTurn('t0'), toolTurn('t1')]
    const h = createHarness({ scrollTop: 0, measurements: [{ start: 0 }, { start: 400 }] })
    const { result } = renderJump(h, { turns })

    act(() => result.current.stepPrev())

    expect(h.scrollToIndex).not.toHaveBeenCalled()
    expect(h.container.scrollTop).toBe(0)
  })

  it('falls through to the absolute end when no working turn starts below the viewport', () => {
    const turns = [toolTurn('t0')]
    const h = createHarness({ scrollTop: 1500, scrollHeight: 2000, measurements: [{ start: 0 }] })
    const { result } = renderJump(h, { turns })

    act(() => result.current.stepNext())

    expect(h.scrollToIndex).not.toHaveBeenCalled()
    expect(h.container.scrollTop).toBe(2000)
  })

  describe('autoscroll engagement transitions', () => {
    it('stepPrev raises user intent', () => {
      const onIntent = vi.fn()
      const turns = [toolTurn('t0'), toolTurn('t1')]
      const h = createHarness({ scrollTop: 900, measurements: [{ start: 0 }, { start: 800 }] })
      const { result } = renderJump(h, { turns, onIntent })

      act(() => result.current.stepPrev())

      expect(onIntent).toHaveBeenCalled()
    })

    it('stepNext fall-through re-engages autoscroll instead of raising intent', () => {
      const onIntent = vi.fn()
      const onBottom = vi.fn()
      const turns = [toolTurn('t0'), toolTurn('t1')]
      const h = createHarness({ scrollTop: 1500, measurements: [{ start: 0 }, { start: 400 }] })
      const { result } = renderJump(h, { turns, onIntent, onBottom })

      act(() => result.current.stepNext())

      expect(onBottom).toHaveBeenCalled()
      expect(onIntent).not.toHaveBeenCalled()
    })
  })
})
