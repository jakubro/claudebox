/** Tests for useTurnHeights - minimap heights derived from the content predictor. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TURN_MIN_PREDICTED_HEIGHT_PX } from '../../../config/dimensions'
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
    expect(result.current.turnHeights.a).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)
    expect(result.current.getLogicalScrollHeight()).toBe(3 * TURN_MIN_PREDICTED_HEIGHT_PX)
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
})
