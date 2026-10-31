/** Tests for the useInlineReplies buffer hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import useInlineReplies from './useInlineReplies'

function renderWithOneReply() {
  const hook = renderHook(() => useInlineReplies('s1'))
  act(() => hook.result.current.add({ text: 'q', turnId: 't1', from: 'user' }))

  return hook
}

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
    const { result } = renderWithOneReply()
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

  it('claimWireReplies drops blank and thread-linked replies without touching the buffer', () => {
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

    const claim = result.current.claimWireReplies()
    const { wire, ids } = claim

    expect(wire).toEqual([
      {
        id: withReply.id,
        quote: 'q2',
        from: 'assistant',
        response: 'kept',
        turnId: 't2',
        prefix: 'pre ',
        suffix: ' suf',
        offset: 5,
      },
    ])
    expect(ids).toEqual([withReply.id])
    // The buffer is untouched until the claim settles as sent.
    expect(result.current.unsent).toHaveLength(2)

    act(() => result.current.settleClaim(claim, true))

    // Only the id actually sent clears - the still-blank q1 was never part of the wire.
    expect(result.current.unsent).toHaveLength(1)
    expect(result.current.unsent[0].quote).toBe('q1')
  })

  it('settleClaim(sent) clears only the claimed replies; one added during the send stays', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => result.current.add({ text: 'q1', turnId: 't1', from: 'user' }))
    act(() => result.current.editReply(result.current.unsent[0].id, 'first answer'))

    const claim = result.current.claimWireReplies()

    act(() => result.current.add({ text: 'q2', turnId: 't2', from: 'user' }))
    act(() => result.current.editReply(result.current.unsent[1].id, 'second answer'))

    act(() => result.current.settleClaim(claim, true))

    expect(result.current.unsent).toHaveLength(1)
    expect(result.current.unsent[0].response).toBe('second answer')
    expect(result.current.claimWireReplies().wire.map(r => r.response)).toEqual(['second answer'])
  })

  it('a claimed reply is left out of a second claim and of hasSendable', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => result.current.add({ text: 'q1', turnId: 't1', from: 'user' }))
    act(() => result.current.editReply(result.current.unsent[0].id, 'only once'))

    expect(result.current.hasSendable()).toBe(true)
    const first = result.current.claimWireReplies()

    expect(first.ids).toHaveLength(1)
    expect(result.current.claimWireReplies().ids).toEqual([])
    expect(result.current.hasSendable()).toBe(false)
  })

  it('a reply asked on its own is never sendable, though its thread has not linked yet', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => result.current.add({ text: 'q1', turnId: 't1', from: 'user' }))
    const { id } = result.current.unsent[0]
    act(() => result.current.editReply(id, 'a follow-up typed at once'))

    result.current.markAsked(id)

    expect(result.current.hasSendable()).toBe(false)
    expect(result.current.claimWireReplies().ids).toEqual([])
  })

  it('settleClaim(failed) leaves the replies buffered and claimable again', () => {
    const { result } = renderHook(() => useInlineReplies('s1'))
    act(() => result.current.add({ text: 'q1', turnId: 't1', from: 'user' }))
    act(() => result.current.editReply(result.current.unsent[0].id, 'retry me'))

    const claim = result.current.claimWireReplies()
    act(() => result.current.settleClaim(claim, false))

    expect(result.current.unsent).toHaveLength(1)
    expect(result.current.hasSendable()).toBe(true)
    expect(result.current.claimWireReplies().ids).toEqual(claim.ids)
  })

  it('links a promoted session id without touching the reply text', () => {
    const { result } = renderWithOneReply()
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
    const { result } = renderWithOneReply()
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

    act(() => result.current.settleClaim(result.current.claimWireReplies(), true))

    expect(result.current.unsent).toHaveLength(1)
    expect(result.current.unsent[0]).toMatchObject({ id: threaded.id, railPromoted: true })
  })

  describe('a send or link resolving after the reader switched sessions', () => {
    function withReplyInA() {
      const hook = renderHook(({ sessionId }) => useInlineReplies(sessionId), {
        initialProps: { sessionId: 'A' },
      })
      act(() => hook.result.current.add({ text: 'q', turnId: 't1', from: 'assistant' }))
      const id = hook.result.current.unsent[0].id
      act(() => hook.result.current.editReply(id, 'my reply'))
      return { ...hook, id }
    }

    it('a claim settled after the reader switched sessions clears the owner session record', () => {
      const { result, rerender } = withReplyInA()
      const claim = result.current.claimWireReplies()
      expect(claim.sessionId).toBe('A')

      rerender({ sessionId: 'B' })
      act(() => result.current.add({ text: 'b', turnId: 't9', from: 'user' }))
      act(() => result.current.settleClaim(claim, true))

      expect(localStorage.getItem('inline-replies:A')).toBe(null)
      expect(result.current.unsent.map(r => r.quote)).toEqual(['b'])
    })

    it("links a side thread into A's record, so a later reply in A reuses it", () => {
      const { result, rerender, id } = withReplyInA()

      rerender({ sessionId: 'B' })
      act(() => result.current.linkThreadSession(id, 'side-1', 'A'))
      rerender({ sessionId: 'A' })

      expect(result.current.unsent[0].threadSessionId).toBe('side-1')
    })
  })
})
