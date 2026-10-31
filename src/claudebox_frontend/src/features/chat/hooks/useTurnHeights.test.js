/** Tests for useTurnHeights - minimap heights from measured row sizes, else the predictor. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THREAD_FOLD_ROW_HEIGHT_PX } from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import { createRowSizeStore } from '../utils/rowSizeStore'
import useTurnHeights from './useTurnHeights'

const messagesRef = { current: { clientWidth: 800 } }

const turn = (id, extra = {}) => ({
  turn_id: id,
  userMessage: 'hi',
  events: [],
  attachments: null,
  ...extra,
})

describe('useTurnHeights', () => {
  it('gives every turn a height, mounted or not', () => {
    const turns = [turn('a'), turn('b'), turn('c')]
    const { result } = renderHook(() => useTurnHeights(messagesRef, turns))

    expect(Object.keys(result.current.turnHeights)).toEqual(['a', 'b', 'c'])
    expect(result.current.turnHeights.a).toBe(116)
  })

  it('sizes a turn from its content', () => {
    const light = turn('a')
    const heavy = turn('b', {
      events: [
        { type: 'assistant', subtype: 'text', content: 'x'.repeat(4000) },
        { subtype: 'tool_use' },
      ],
    })
    const { result } = renderHook(() => useTurnHeights(messagesRef, [light, heavy]))

    expect(result.current.turnHeights.b).toBeGreaterThan(result.current.turnHeights.a)
  })

  it('sizes a collapsed turn by its short strip', () => {
    const heavy = turn('a', {
      events: [{ type: 'assistant', subtype: 'text', content: 'x'.repeat(4000) }],
    })
    const { result: expanded } = renderHook(() => useTurnHeights(messagesRef, [heavy]))
    const { result: collapsed } = renderHook(() =>
      useTurnHeights(messagesRef, [heavy], new Set(['a'])),
    )

    expect(collapsed.current.turnHeights.a).toBeLessThan(expanded.current.turnHeights.a)
  })

  // Heights are keyed by turn id, so a turn keeps its size when the list shifts underneath it -
  // a compaction dropping an earlier turn, or a rewind.
  it('keeps heights keyed by turn id when the list shifts', () => {
    const { result, rerender } = renderHook(({ t }) => useTurnHeights(messagesRef, t), {
      initialProps: { t: [turn('a'), turn('b'), turn('c')] },
    })
    const before = result.current.turnHeights.c

    rerender({ t: [turn('b'), turn('c')] })

    expect(Object.keys(result.current.turnHeights)).toEqual(['b', 'c'])
    expect(result.current.turnHeights.c).toBe(before)
  })

  // With the list windowed there's nothing to measure for most turns, so every one is predicted -
  // sizing only the mounted few would flatten the rest.
  it('sizes the human message of every turn, mounted or not', () => {
    const short = turn('a')
    const long = turn('b', { userMessage: 'x'.repeat(2000) })
    const { result } = renderHook(() => useTurnHeights(messagesRef, [short, long]))

    expect(Object.keys(result.current.userMessageHeights)).toEqual(['a', 'b'])
    expect(result.current.userMessageHeights.b).toBeGreaterThan(result.current.userMessageHeights.a)
  })

  it('skips turns that carry no id', () => {
    const { result } = renderHook(() =>
      useTurnHeights(messagesRef, [turn('a'), { ...turn('x'), turn_id: null }]),
    )

    expect(Object.keys(result.current.turnHeights)).toEqual(['a'])
  })

  it('prices a Bash-heavy turn lower once splitEnabled flips on (memo dependency)', () => {
    const bashy = turn('a', {
      events: [{ type: 'assistant', subtype: 'tool_use', content: 'Bash' }],
    })
    const { result, rerender } = renderHook(
      ({ splitEnabled }) => useTurnHeights(messagesRef, [bashy], undefined, splitEnabled),
      { initialProps: { splitEnabled: false } },
    )
    const splitOff = result.current.turnHeights.a

    rerender({ splitEnabled: true })

    expect(result.current.turnHeights.a).toBeLessThan(splitOff)
  })

  describe('with measured row sizes', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('uses a measured size over the prediction, and predicts the rest', () => {
      const rowSizes = createRowSizeStore()
      rowSizes.set('a', 711)
      const turns = [turn('a'), turn('b')]
      const { result } = renderHook(() =>
        useTurnHeights(messagesRef, turns, undefined, TurnRoutingMode.OFF, -1, false, rowSizes),
      )

      expect(result.current.turnHeights).toEqual({ a: 711, b: 116 })
    })

    it('picks up a size published after the first render', () => {
      const rowSizes = createRowSizeStore()
      const turns = [turn('a')]
      const { result } = renderHook(() =>
        useTurnHeights(messagesRef, turns, undefined, TurnRoutingMode.OFF, -1, false, rowSizes),
      )
      expect(result.current.turnHeights.a).toBe(116)

      act(() => {
        rowSizes.set('a', 300)
        vi.advanceTimersToNextFrame()
      })

      expect(result.current.turnHeights.a).toBe(300)
    })

    it('keeps folded turns at the fold pricing whatever was measured for them', () => {
      const rowSizes = createRowSizeStore()
      rowSizes.set('a', 500)
      rowSizes.set('b', 500)
      rowSizes.set('c', 500)
      const turns = [turn('a'), turn('b'), turn('c')]
      const { result } = renderHook(() =>
        useTurnHeights(messagesRef, turns, undefined, TurnRoutingMode.OFF, 1, false, rowSizes),
      )

      expect(result.current.turnHeights).toEqual({ a: THREAD_FOLD_ROW_HEIGHT_PX, b: 0, c: 500 })
    })
  })
})
