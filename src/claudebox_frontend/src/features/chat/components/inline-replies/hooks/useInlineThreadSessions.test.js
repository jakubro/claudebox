/** Tests for useInlineThreadSessions - per-float side-thread fork/resume/submit/subscribe. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveThreadTurns } from '../threadEvents'
import useInlineThreadSessions from './useInlineThreadSessions'

vi.mock('../../../../../api/chat', () => ({
  sendSideMessage: vi.fn(),
  interruptSide: vi.fn(),
}))
vi.mock('../../../../../api/sessions', () => ({
  forkSession: vi.fn(),
  resumeSession: vi.fn(),
  getSessionEvents: vi.fn(),
}))

const subscribeSession = vi.fn()
vi.mock('../../../../../context/EventsContext', () => ({
  useEvents: () => ({ subscribeSession }),
}))

import { interruptSide, sendSideMessage } from '../../../../../api/chat'
import { forkSession, getSessionEvents, resumeSession } from '../../../../../api/sessions'

function sseMessage(data) {
  return { data: JSON.stringify(data) }
}

function exchanges(entry) {
  return deriveThreadTurns(entry.events, entry.pending).turns.map(turn => ({
    question: turn.userMessage,
    texts: turn.events.filter(e => e.subtype === 'text').map(e => e.content),
  }))
}

// Live events reach the thread on a batching timer, never one state update per event.
async function flushBatches() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 80))
  })
}

function makeReply(overrides = {}) {
  return {
    id: 'r1',
    quote: 'context window',
    response: 'why this branch?',
    threadSessionId: null,
    ...overrides,
  }
}

function renderForking() {
  forkSession.mockResolvedValue({ session_id: 'side-1' })
  sendSideMessage.mockResolvedValue(undefined)

  return renderHook(() => useInlineThreadSessions('ctr-1'))
}

function renderResuming() {
  resumeSession.mockResolvedValue({ session_id: 'side-1' })
  sendSideMessage.mockResolvedValue(undefined)

  return renderHook(() => useInlineThreadSessions('ctr-1'))
}

async function renderAsked() {
  const hook = renderForking()
  await act(async () => {
    await hook.result.current.submit(makeReply(), 'parent-1', 'why?')
  })

  return hook
}

describe('useInlineThreadSessions', () => {
  let unsubscribe

  beforeEach(() => {
    vi.clearAllMocks()
    unsubscribe = vi.fn()
    subscribeSession.mockReturnValue(unsubscribe)
  })

  it('submit() with blank text is a no-op', async () => {
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', '   ')
    })

    expect(forkSession).not.toHaveBeenCalled()
    expect(result.current.threads.size).toBe(0)
  })

  it('submit() on a fresh reply forks the parent, attaches, and sends the quote then the reply', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1', container_id: 'ctr-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why this branch?')
    })

    expect(forkSession).toHaveBeenCalledWith('parent-1', null, { share_container: true })
    expect(subscribeSession).toHaveBeenCalledWith('side-1', 'ctr-1', expect.any(Function), {
      replay: false,
      onError: expect.any(Function),
    })
    expect(sendSideMessage).toHaveBeenCalledWith(
      'side-1',
      '> context window\n\nwhy this branch?',
      'ctr-1',
    )

    const entry = result.current.threads.get('r1')
    expect(entry.sessionId).toBe('side-1')
    expect(entry.running).toBe(true)
    expect(exchanges(entry)).toEqual([
      { question: '> context window\n\nwhy this branch?', texts: [] },
    ])
  })

  it('submit() quotes every line of a multi-line quote, blank lines included', async () => {
    const { result } = renderForking()

    await act(async () => {
      await result.current.submit(
        makeReply({ quote: 'if (a) {\n\n  b()' }),
        'parent-1',
        '  explain  ',
      )
    })

    expect(sendSideMessage).toHaveBeenCalledWith(
      'side-1',
      '> if (a) {\n>\n>   b()\n\nexplain',
      'ctr-1',
    )
  })

  it('submit() on an already-linked reply resumes instead of forking', async () => {
    const { result } = renderResuming()

    await act(async () => {
      await result.current.submit(makeReply({ threadSessionId: 'side-1' }), 'parent-1', 'again?')
    })

    expect(forkSession).not.toHaveBeenCalled()
    expect(resumeSession).toHaveBeenCalledWith('side-1')
    expect(sendSideMessage).toHaveBeenCalledWith('side-1', 'again?', 'ctr-1')
  })

  it('a follow-up submit adds a new exchange rather than replacing prior ones', async () => {
    resumeSession.mockResolvedValue({ session_id: 'side-1' })
    const { result } = renderForking()

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'first question')
    })
    // Simulate the first exchange completing and the reply now carrying the session link.
    const linkedReply = makeReply({ threadSessionId: 'side-1' })

    await act(async () => {
      await result.current.submit(linkedReply, 'parent-1', 'follow-up question')
    })

    expect(exchanges(result.current.threads.get('r1')).map(x => x.question)).toEqual([
      '> context window\n\nfirst question',
      'follow-up question',
    ])
  })

  it('a second ask fired while the first fork is on its way joins that fork as a follow-up', async () => {
    let releaseFork
    forkSession.mockReturnValue(
      new Promise(resolve => {
        releaseFork = () => resolve({ session_id: 'side-1' })
      }),
    )
    const { result } = renderResuming()

    await act(async () => {
      const first = result.current.submit(makeReply(), 'parent-1', 'first question')
      const second = result.current.submit(makeReply(), 'parent-1', 'second question')
      releaseFork()
      await Promise.all([first, second])
    })

    expect(forkSession).toHaveBeenCalledTimes(1)
    expect(sendSideMessage.mock.calls).toEqual([
      ['side-1', '> context window\n\nfirst question', 'ctr-1'],
      ['side-1', 'second question', 'ctr-1'],
    ])
    expect(exchanges(result.current.threads.get('r1')).map(x => x.question)).toEqual([
      '> context window\n\nfirst question',
      'second question',
    ])
  })

  it('an ask whose fork failed leaves the next one to fork again beneath its quote', async () => {
    forkSession
      .mockRejectedValueOnce(new Error('fork failed'))
      .mockResolvedValueOnce({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'first question')
    })
    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'once more')
    })

    expect(forkSession).toHaveBeenCalledTimes(2)
    expect(sendSideMessage).toHaveBeenCalledWith('side-1', '> context window\n\nonce more', 'ctr-1')
  })

  it('events arriving before the question is echoed join the exchange that asked', async () => {
    const { result } = await renderAsked()

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'assistant', subtype: 'text', content: 'because ' }))
      onMessage(sseMessage({ type: 'assistant', subtype: 'text', content: 'it does' }))
    })
    await flushBatches()

    expect(exchanges(result.current.threads.get('r1'))).toEqual([
      { question: '> context window\n\nwhy?', texts: ['because ', 'it does'] },
    ])
  })

  it('a trailing chunk tagged with an earlier turn id lands on that turn, not the newest entry', async () => {
    resumeSession.mockResolvedValue({ session_id: 'side-1' })
    const { result } = renderForking()

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'first?')
    })

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'user', is_human: true, turn_id: 'turn-a', content: 'first?' }))
    })
    await flushBatches()

    await act(async () => {
      await result.current.submit(makeReply({ threadSessionId: 'side-1' }), 'parent-1', 'second?')
    })

    act(() => {
      onMessage(sseMessage({ type: 'user', is_human: true, turn_id: 'turn-b', content: 'second?' }))
      // A frame from the FIRST turn arrives after the second question was already asked.
      onMessage(
        sseMessage({
          type: 'assistant',
          subtype: 'text',
          turn_id: 'turn-a',
          content: 'stale text',
        }),
      )
      onMessage(
        sseMessage({
          type: 'assistant',
          subtype: 'text',
          turn_id: 'turn-b',
          content: 'fresh text',
        }),
      )
    })

    await flushBatches()

    expect(exchanges(result.current.threads.get('r1'))).toEqual([
      { question: 'first?', texts: ['stale text'] },
      { question: 'second?', texts: ['fresh text'] },
    ])
  })

  it('a result event marks the thread not-running and detaches the subscription', async () => {
    const { result } = await renderAsked()

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'result' }))
    })
    await flushBatches()

    expect(result.current.threads.get('r1').running).toBe(false)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('an injected error marks not-running, keeps the error in the exchange, and detaches', async () => {
    const { result } = await renderAsked()

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'system', subtype: 'error', content: 'boom' }))
    })
    await flushBatches()

    const entry = result.current.threads.get('r1')
    expect(entry.running).toBe(false)
    expect(entry.error).toBeNull()
    expect(deriveThreadTurns(entry.events, entry.pending).turns[0].events).toContainEqual(
      expect.objectContaining({ subtype: 'error', content: 'boom' }),
    )
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("an injected error with no text of its own gets the float's error line", async () => {
    const { result } = await renderAsked()

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'system', subtype: 'error', content: '  ' }))
    })
    await flushBatches()

    expect(result.current.threads.get('r1').error).toBe('The answer failed to arrive')
  })

  it('a stream that exhausts its reconnects marks not-running, records an error, and detaches', async () => {
    const { result } = await renderAsked()

    const onError = subscribeSession.mock.calls[0][3].onError

    act(() => {
      onError()
    })

    expect(result.current.threads.get('r1').running).toBe(false)
    expect(result.current.threads.get('r1').error).toBeTruthy()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('a completion on one thread leaves a second, still-running thread untouched', async () => {
    forkSession
      .mockResolvedValueOnce({ session_id: 'side-1' })
      .mockResolvedValueOnce({ session_id: 'side-2' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply({ id: 'r1' }), 'parent-1', 'first?')
    })
    await act(async () => {
      await result.current.submit(makeReply({ id: 'r2' }), 'parent-1', 'second?')
    })

    const onMessageR1 = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessageR1(sseMessage({ type: 'result' }))
    })
    await flushBatches()

    expect(result.current.threads.get('r1').running).toBe(false)
    expect(result.current.threads.get('r2').running).toBe(true)
  })

  it('load() keeps the persisted events, one exchange per human message', async () => {
    getSessionEvents.mockResolvedValue({
      events: [
        { type: 'user', is_human: true, content: 'why this branch?' },
        { type: 'assistant', subtype: 'text', content: 'because ' },
        { type: 'assistant', subtype: 'text', content: 'it handles it' },
        { type: 'user', is_human: true, content: 'and the other one?' },
        { type: 'assistant', subtype: 'text', content: 'that one is unrelated' },
      ],
      running: false,
    })
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.load('r1', 'side-1')
    })

    const entry = result.current.threads.get('r1')
    expect(entry).toMatchObject({ sessionId: 'side-1', running: false })
    expect(exchanges(entry)).toEqual([
      { question: 'why this branch?', texts: ['because ', 'it handles it'] },
      { question: 'and the other one?', texts: ['that one is unrelated'] },
    ])
    expect(subscribeSession).not.toHaveBeenCalled() // finished - no live re-attach
  })

  it('load() re-attaches without replay when the session is still running', async () => {
    getSessionEvents.mockResolvedValue({
      events: [{ type: 'user', is_human: true, content: 'why?' }],
      running: true,
    })
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.load('r1', 'side-1')
    })

    expect(result.current.threads.get('r1').running).toBe(true)
    expect(subscribeSession).toHaveBeenCalledWith('side-1', 'ctr-1', expect.any(Function), {
      replay: false,
      onError: expect.any(Function),
    })
  })

  it('a late fragment for a reload-recovered exchange lands on it, not on a follow-up asked before it finished', async () => {
    getSessionEvents.mockResolvedValue({
      events: [{ type: 'user', is_human: true, content: 'why?', turn_id: 'turn-old' }],
      running: true,
    })
    const { result } = renderResuming()

    await act(async () => {
      await result.current.load('r1', 'side-1')
    })

    await act(async () => {
      await result.current.submit(
        makeReply({ threadSessionId: 'side-1' }),
        'parent-1',
        'and this one?',
      )
    })

    const onMessage = subscribeSession.mock.calls[subscribeSession.mock.calls.length - 1][2]

    act(() => {
      onMessage(
        sseMessage({ type: 'user', is_human: true, turn_id: 'turn-new', content: 'and this one?' }),
      )
      // The reload-recovered exchange's own tail arrives after the follow-up was already asked.
      onMessage(
        sseMessage({ type: 'assistant', subtype: 'text', turn_id: 'turn-old', content: 'because' }),
      )
      onMessage(
        sseMessage({ type: 'assistant', subtype: 'text', turn_id: 'turn-new', content: 'sure' }),
      )
    })

    await flushBatches()

    expect(exchanges(result.current.threads.get('r1'))).toEqual([
      { question: 'why?', texts: ['because'] },
      { question: 'and this one?', texts: ['sure'] },
    ])
  })

  it('interruptThread() calls interruptSide and marks the thread not-running', async () => {
    interruptSide.mockResolvedValue(undefined)
    const { result } = renderForking()

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why?')
    })
    await act(async () => {
      await result.current.interruptThread('r1')
    })

    expect(interruptSide).toHaveBeenCalledWith('side-1')
    expect(result.current.threads.get('r1').running).toBe(false)
  })

  it('detaching drops events still waiting for the batch, so a reload cannot add them twice', async () => {
    const { result } = await renderAsked()

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'assistant', subtype: 'text', content: 'late' }))
      result.current.detach('r1')
    })
    await flushBatches()

    expect(result.current.threads.get('r1').events).toEqual([])
  })

  it('releaseAll() closes every open subscription', async () => {
    const { result } = await renderAsked()

    act(() => {
      result.current.releaseAll()
    })

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
