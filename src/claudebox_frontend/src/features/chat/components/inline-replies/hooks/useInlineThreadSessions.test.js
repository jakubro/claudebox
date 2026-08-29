/** Tests for useInlineThreadSessions - per-float side-thread fork/resume/submit/subscribe. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useInlineThreadSessions, { buildThreadHistory } from './useInlineThreadSessions'

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

function makeReply(overrides = {}) {
  return { id: 'r1', response: 'why this branch?', threadSessionId: null, ...overrides }
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

  it('submit() on a fresh reply forks the parent, attaches, and sends', async () => {
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
    expect(sendSideMessage).toHaveBeenCalledWith('side-1', 'why this branch?')

    const entry = result.current.threads.get('r1')
    expect(entry.sessionId).toBe('side-1')
    expect(entry.running).toBe(true)
    expect(entry.history).toEqual([{ question: 'why this branch?', answer: '', turnId: null }])
  })

  it('submit() on an already-linked reply resumes instead of forking', async () => {
    resumeSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply({ threadSessionId: 'side-1' }), 'parent-1', 'again?')
    })

    expect(forkSession).not.toHaveBeenCalled()
    expect(resumeSession).toHaveBeenCalledWith('side-1')
    expect(sendSideMessage).toHaveBeenCalledWith('side-1', 'again?')
  })

  it('a follow-up submit appends a new history entry rather than replacing prior ones', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    resumeSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'first question')
    })
    // Simulate the first exchange completing and the reply now carrying the session link.
    const linkedReply = makeReply({ threadSessionId: 'side-1' })

    await act(async () => {
      await result.current.submit(linkedReply, 'parent-1', 'follow-up question')
    })

    expect(result.current.threads.get('r1').history.map(h => h.question)).toEqual([
      'first question',
      'follow-up question',
    ])
  })

  it('two submits fired without an await between them both keep their own entry', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await Promise.all([
        result.current.submit(makeReply(), 'parent-1', 'first question'),
        result.current.submit(makeReply(), 'parent-1', 'second question'),
      ])
    })

    expect(result.current.threads.get('r1').history.map(h => h.question)).toEqual([
      'first question',
      'second question',
    ])
  })

  it('streamed assistant text appends to the last history entry only', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why?')
    })

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'assistant', subtype: 'text', content: 'because ' }))
      onMessage(sseMessage({ type: 'assistant', subtype: 'text', content: 'it does' }))
    })

    expect(result.current.threads.get('r1').history[0].answer).toBe('because it does')
  })

  it('a trailing chunk tagged with an earlier turn id lands on that turn, not the newest entry', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    resumeSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'first?')
    })

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'user', is_human: true, turn_id: 'turn-a', content: 'first?' }))
    })

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

    const history = result.current.threads.get('r1').history
    expect(history[0].answer).toBe('stale text')
    expect(history[1].answer).toBe('fresh text')
  })

  it('a result event marks the thread not-running and detaches the subscription', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why?')
    })

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'result' }))
    })

    expect(result.current.threads.get('r1').running).toBe(false)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('an injected error marks not-running, records the error, and detaches', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why?')
    })

    const onMessage = subscribeSession.mock.calls[0][2]

    act(() => {
      onMessage(sseMessage({ type: 'system', subtype: 'error', content: 'boom' }))
    })

    expect(result.current.threads.get('r1').running).toBe(false)
    expect(result.current.threads.get('r1').error).toBe('boom')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('a stream that exhausts its reconnects marks not-running, records an error, and detaches', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why?')
    })

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

    expect(result.current.threads.get('r1').running).toBe(false)
    expect(result.current.threads.get('r2').running).toBe(true)
  })

  it('load() rebuilds history from persisted events, segmented on each human message', async () => {
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

    expect(result.current.threads.get('r1')).toMatchObject({
      sessionId: 'side-1',
      running: false,
      history: [
        { question: 'why this branch?', answer: 'because it handles it' },
        { question: 'and the other one?', answer: 'that one is unrelated' },
      ],
    })
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
    resumeSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

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

    const history = result.current.threads.get('r1').history
    expect(history[0].answer).toBe('because')
    expect(history[1].answer).toBe('sure')
  })

  it('interruptThread() calls interruptSide and marks the thread not-running', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    interruptSide.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why?')
    })
    await act(async () => {
      await result.current.interruptThread('r1')
    })

    expect(interruptSide).toHaveBeenCalledWith('side-1')
    expect(result.current.threads.get('r1').running).toBe(false)
  })

  it('releaseAll() closes every open subscription', async () => {
    forkSession.mockResolvedValue({ session_id: 'side-1' })
    sendSideMessage.mockResolvedValue(undefined)
    const { result } = renderHook(() => useInlineThreadSessions('ctr-1'))

    await act(async () => {
      await result.current.submit(makeReply(), 'parent-1', 'why?')
    })

    act(() => {
      result.current.releaseAll()
    })

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('buildThreadHistory', () => {
  const forkDivider = (parentId = 'source-session') => ({
    type: 'system',
    subtype: 'container_restarted',
    message_data: { fork_parent_session_id: parentId },
  })

  it('a divider mid-way yields only the exchanges after it', () => {
    const events = [
      { type: 'user', is_human: true, content: 'inherited question' },
      { type: 'assistant', subtype: 'text', content: 'inherited answer' },
      forkDivider(),
      { type: 'user', is_human: true, content: 'own question' },
      { type: 'assistant', subtype: 'text', content: 'own answer' },
    ]

    expect(buildThreadHistory(events)).toEqual([
      { question: 'own question', answer: 'own answer', turnId: null },
    ])
  })

  it('a divider at the very top yields everything after it', () => {
    const events = [
      forkDivider(),
      { type: 'user', is_human: true, content: 'own question' },
      { type: 'assistant', subtype: 'text', content: 'own answer' },
    ]

    expect(buildThreadHistory(events)).toEqual([
      { question: 'own question', answer: 'own answer', turnId: null },
    ])
  })

  it('no divider at all yields everything, unchanged from before this rule', () => {
    const events = [
      { type: 'user', is_human: true, content: 'q1' },
      { type: 'assistant', subtype: 'text', content: 'a1' },
    ]

    expect(buildThreadHistory(events)).toEqual([{ question: 'q1', answer: 'a1', turnId: null }])
  })

  it('a plain restart divider naming no source conversation is not a seam - yields everything', () => {
    const events = [
      { type: 'system', subtype: 'container_restarted', message_data: null },
      { type: 'user', is_human: true, content: 'q1' },
      { type: 'assistant', subtype: 'text', content: 'a1' },
    ]

    expect(buildThreadHistory(events)).toEqual([{ question: 'q1', answer: 'a1', turnId: null }])
  })

  it('a fork-of-a-fork: two dividers present, the LAST one is the seam', () => {
    const events = [
      forkDivider('ancestor-session'),
      { type: 'user', is_human: true, content: 'inherited-from-ancestor' },
      forkDivider('this-session'),
      { type: 'user', is_human: true, content: 'own question' },
      { type: 'assistant', subtype: 'text', content: 'own answer' },
    ]

    expect(buildThreadHistory(events)).toEqual([
      { question: 'own question', answer: 'own answer', turnId: null },
    ])
  })

  it("captures each entry's own turn id from its initiating human message", () => {
    const events = [
      { type: 'user', is_human: true, content: 'q1', turn_id: 'turn-a' },
      { type: 'assistant', subtype: 'text', content: 'a1' },
      { type: 'user', is_human: true, content: 'q2', turn_id: 'turn-b' },
      { type: 'assistant', subtype: 'text', content: 'a2' },
    ]

    expect(buildThreadHistory(events)).toEqual([
      { question: 'q1', answer: 'a1', turnId: 'turn-a' },
      { question: 'q2', answer: 'a2', turnId: 'turn-b' },
    ])
  })
})
