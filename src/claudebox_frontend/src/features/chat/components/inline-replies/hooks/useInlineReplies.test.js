/** Tests for the useInlineReplies buffer hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import useInlineReplies from './useInlineReplies'

describe('useInlineReplies', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('adds a comment with quote + attribution + durable anchor and an empty reply', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() =>
      result.current.add({
        text: 'quoted',
        turnId: 't1',
        from: 'assistant',
        prefix: 'before ',
        suffix: ' after',
        offset: 42,
      }),
    )

    expect(result.current.unsent).toHaveLength(1)
    expect(result.current.unsent[0]).toMatchObject({
      quote: 'quoted',
      from: 'assistant',
      turnId: 't1',
      prefix: 'before ',
      suffix: ' after',
      offset: 42,
      response: '',
      threadSessionId: null,
      promotedSessionId: null,
    })
  })

  it('edits and removes an unsent comment', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => result.current.add({ text: 'q', turnId: 't1', from: 'user' }))
    const id = result.current.unsent[0].id

    act(() => result.current.editReply(id, 'my reply'))
    expect(result.current.unsent[0].response).toBe('my reply')

    act(() => result.current.remove(id))
    expect(result.current.unsent).toHaveLength(0)
  })

  it('persists the unsent buffer to localStorage keyed per session and restores it', () => {
    const { result, unmount } = renderHook(() => useInlineReplies('sX'))
    act(() => result.current.add({ text: 'q', turnId: 't1', from: 'user' }))

    expect(JSON.parse(localStorage.getItem('inline-replies:sX'))).toHaveLength(1)

    unmount()
    const { result: restored } = renderHook(() => useInlineReplies('sX'))
    expect(restored.current.unsent).toHaveLength(1)
  })

  it('drops blank replies on send, clears the buffer, and returns the anchored payload', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => {
      result.current.add({ text: 'q1', turnId: 't1', from: 'user' })
      result.current.add({
        text: 'q2',
        turnId: 't2',
        from: 'assistant',
        prefix: 'pre ',
        suffix: ' suf',
        offset: 5,
      })
    })

    const withReply = result.current.unsent[1]
    act(() => result.current.editReply(withReply.id, 'kept'))

    let wire
    act(() => {
      wire = result.current.markSent()
    })

    expect(wire).toEqual([
      {
        quote: 'q2',
        from: 'assistant',
        response: 'kept',
        turnId: 't2',
        prefix: 'pre ',
        suffix: ' suf',
        offset: 5,
      },
    ])
    expect(result.current.unsent).toHaveLength(0)
  })

  it('links a promoted session id without touching the reply text', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => result.current.add({ text: 'q', turnId: 't1', from: 'user' }))
    const id = result.current.unsent[0].id
    act(() => result.current.linkThreadSession(id, 'side-1'))
    act(() => result.current.editReply(id, 'and this one?'))

    act(() => result.current.linkPromotedSession(id, 'promoted-1'))

    expect(result.current.unsent[0]).toMatchObject({
      threadSessionId: 'side-1',
      promotedSessionId: 'promoted-1',
      response: 'and this one?',
    })
  })

  it('marks a thread rail-promoted without touching its session link or text', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => result.current.add({ text: 'q', turnId: 't1', from: 'user' }))
    const id = result.current.unsent[0].id
    act(() => result.current.linkThreadSession(id, 'side-1'))

    expect(result.current.unsent[0].railPromoted).toBe(false)

    act(() => result.current.linkRailPromotion(id))

    expect(result.current.unsent[0]).toMatchObject({
      threadSessionId: 'side-1',
      railPromoted: true,
      promotedSessionId: null,
    })
  })

  it('keeps a rail-promoted thread in the buffer across a send, like any other thread-linked reply', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => {
      result.current.add({ text: 'q1', turnId: 't1', from: 'user' })
      result.current.add({ text: 'q2', turnId: 't2', from: 'assistant' })
    })
    const [ordinary, threaded] = result.current.unsent
    act(() => result.current.editReply(ordinary.id, 'batched reply'))
    act(() => result.current.linkThreadSession(threaded.id, 'side-1'))
    act(() => result.current.linkRailPromotion(threaded.id))

    act(() => result.current.markSent())

    expect(result.current.unsent).toHaveLength(1)
    expect(result.current.unsent[0]).toMatchObject({ id: threaded.id, railPromoted: true })
  })
})
