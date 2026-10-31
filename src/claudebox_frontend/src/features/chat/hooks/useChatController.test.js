/** Tests for useChatController hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAddress, setWorkspaceId } from '../../../api/apiClient'
import useChatController from './useChatController'

// --- Mutable mock state ---

let mockSessionId = 'session-1'
let mockResultCount = 0
let mockIsConnected = false
let mockInteractionData = {}
let mockRoutedSessionId = 'session-1'
let mockCreations = { current: 0, bySeq: {} }
let mockCreatePending = false
let mockApplyingPicks = false
let mockContainerId = null

// --- Mock context hooks ---

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: mockSessionId, isApplyingPendingConfig: mockApplyingPicks }),
  useSessionId: () => mockSessionId,
  useSessionActions: () => ({ reloadSession: vi.fn() }),
}))

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => ({
    resultCount: mockResultCount,
    isConnected: mockIsConnected,
    containerId: mockContainerId,
  }),
}))

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ activeSessionId: mockRoutedSessionId }),
}))

vi.mock('../../../context/StreamingStatusContext', () => ({
  useStreamingStatus: () => ({
    creations: mockCreations,
    isResumeRequestPending: false,
    isCreateRequestPending: mockCreatePending,
    getCreation: () => mockCreations,
  }),
}))

vi.mock('../../../context/InteractionContext', () => ({
  useInteraction: () => ({
    interruptStatus: null,
    startSubmitting: vi.fn(),
    submitSucceeded: vi.fn(),
    submitFailed: vi.fn(),
    setError: vi.fn(),
    errorMessage: null,
    ...mockInteractionData,
  }),
}))

// --- Mock API to prevent real network calls from useSendMessage ---

vi.mock('../../../api/chat', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    sendMessage: vi.fn().mockResolvedValue({}),
  }
})

function clearStoredState() {
  sessionStorage.clear()
  localStorage.clear()
  mockInteractionData = {}
}

describe('useChatController session change scroll reset', () => {
  let rafCallbacks = []

  beforeEach(() => {
    rafCallbacks = []
    mockSessionId = 'session-1'
    mockRoutedSessionId = 'session-1'
    mockCreations = { current: 0, bySeq: {} }
    mockCreatePending = false
    mockResultCount = 0
    mockInteractionData = {}

    vi.stubGlobal('requestAnimationFrame', cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })

    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function flushRAF() {
    const callbacks = rafCallbacks.splice(0)
    for (const cb of callbacks) {
      cb()
    }
  }

  function createProps(overrides = {}) {
    return {
      events: [],
      contextRefs: {
        chatScrollPositionRef: { current: 0 },
        chatAutoScrollEnabledRef: { current: true },
      },
      ...overrides,
    }
  }

  function renderScrolledAway(overrides) {
    const props = createProps(overrides)
    props.contextRefs.chatAutoScrollEnabledRef.current = false
    const view = renderHook(({ p }) => useChatController(p), { initialProps: { p: props } })

    return { props, ...view }
  }

  it('resets autoscroll to enabled on session change', () => {
    // Simulate autoscroll disabled from previous session
    const { props, rerender } = renderScrolledAway()

    // Switch session via context mock
    mockSessionId = 'session-2'
    const newProps = createProps()
    newProps.contextRefs = props.contextRefs
    rerender({ p: newProps })
    flushRAF()

    expect(props.contextRefs.chatAutoScrollEnabledRef.current).toBe(true)
  })

  it('re-enables autoscroll ref on session change', () => {
    const { props, result, rerender } = renderScrolledAway()

    // Disable local ref too
    result.current.scroll.isAutoScrollEnabledRef.current = false

    // Switch session via context mock
    mockSessionId = 'session-2'
    const newProps = createProps()
    newProps.contextRefs = props.contextRefs
    rerender({ p: newProps })
    flushRAF()

    expect(result.current.scroll.isAutoScrollEnabledRef.current).toBe(true)
  })

  it('leaves autoscroll alone on session change while the URL names a turn', () => {
    const { props, result, rerender } = renderScrolledAway({ activeTurnId: 'turn-7' })
    result.current.scroll.isAutoScrollEnabledRef.current = false

    mockSessionId = 'session-2'
    const newProps = createProps({ activeTurnId: 'turn-7' })
    newProps.contextRefs = props.contextRefs
    rerender({ p: newProps })
    flushRAF()

    expect(result.current.scroll.isAutoScrollEnabledRef.current).toBe(false)
    expect(props.contextRefs.chatAutoScrollEnabledRef.current).toBe(false)
  })

  it('does not reset autoscroll when session stays the same', () => {
    const props = createProps()

    const { result, rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: props },
    })

    // Disable autoscroll (user scrolled up)
    result.current.scroll.isAutoScrollEnabledRef.current = false
    props.contextRefs.chatAutoScrollEnabledRef.current = false

    // Re-render with same sessionId but new events
    const sameSessionProps = createProps({ events: [{ type: 'assistant', id: '1' }] })
    sameSessionProps.contextRefs = props.contextRefs
    rerender({ p: sameSessionProps })
    flushRAF()

    expect(result.current.scroll.isAutoScrollEnabledRef.current).toBe(false)
  })

  it('scrolls to bottom via events effect after session change', () => {
    const props = createProps()

    const { rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: props },
    })

    // Switch session with events (simulating replay completion) via context mock
    mockSessionId = 'session-2'
    const newProps = createProps({
      events: [{ type: 'assistant', id: '1' }],
    })
    newProps.contextRefs = props.contextRefs
    rerender({ p: newProps })
    flushRAF()

    // Autoscroll should be enabled, so onEventsChange will scroll
    expect(props.contextRefs.chatAutoScrollEnabledRef.current).toBe(true)
  })
})

describe('useChatController deferred first message', () => {
  beforeEach(() => {
    mockSessionId = 'session-1'
    mockRoutedSessionId = 'session-1'
    mockCreations = { current: 0, bySeq: {} }
    mockCreatePending = false
    mockResultCount = 0
    mockIsConnected = true
    clearStoredState()
  })

  function createProps(overrides = {}) {
    return {
      events: [],
      contextRefs: {
        chatScrollPositionRef: { current: 0 },
        chatAutoScrollEnabledRef: { current: true },
      },
      ...overrides,
    }
  }

  it('keeps queued items running when an error other than a failed send shows', () => {
    const { result, rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: createProps() },
    })
    act(() => {
      result.current.queue.enqueueMessage('stays queued', [])
    })

    mockInteractionData = { errorMessage: 'Failed to apply model' }
    rerender({ p: createProps() })

    expect(result.current.queue.queueItems[0].status).toBe('queued')
  })

  it('re-enters the queue as paused when the deferred first message fails to send', async () => {
    const { sendMessage } = await import('../../../api/chat')
    sendMessage.mockRejectedValueOnce(new Error('network error'))

    const { result, rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: createProps() },
    })

    act(() => {
      result.current.deferred.deferSend('first message', [])
    })
    rerender({ p: createProps() })

    await vi.waitFor(() => {
      expect(result.current.queue.queueItems).toHaveLength(1)
    })

    expect(result.current.queue.queueItems[0]).toMatchObject({
      content: 'first message',
      status: 'paused',
    })
    expect(result.current.deferred.deferredSend).toBeNull()
  })

  it.each([
    ['fails', () => Promise.reject(new Error('refused')), 1],
    ['succeeds', () => Promise.resolve(), 0],
  ])(
    'the held first message stays until its send settles when it %s',
    async (_label, outcome, queued) => {
      const { sendMessage } = await import('../../../api/chat')
      sendMessage.mockClear()
      let settle
      sendMessage.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settle = () => outcome().then(resolve, reject)
          }),
      )
      const { result, rerender } = renderHook(({ p }) => useChatController(p), {
        initialProps: { p: createProps() },
      })

      act(() => {
        result.current.deferred.deferSend('held message', [])
      })
      rerender({ p: createProps() })
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

      expect(result.current.deferred.deferredSend).toMatchObject({ content: 'held message' })
      await act(async () => settle())

      await vi.waitFor(() => expect(result.current.deferred.deferredSend).toBeNull())
      expect(result.current.queue.queueItems).toHaveLength(queued)
      expect(sendMessage).toHaveBeenCalledTimes(1)
    },
  )

  it('does not re-enter the queue when the deferred first message hits a gone container', async () => {
    const { sendMessage, ContainerGoneError } = await import('../../../api/chat')
    sendMessage.mockRejectedValueOnce(new ContainerGoneError())

    const { result, rerender } = renderHook(({ p }) => useChatController(p), {
      initialProps: { p: createProps() },
    })

    act(() => {
      result.current.deferred.deferSend('first message', [])
    })
    rerender({ p: createProps() })

    // Waits for the failure path's own side effect (composer-restore key), which useSendMessage
    // sets before its promise resolves - guarantees useChatController's .then() has run too.
    await vi.waitFor(() => {
      expect(JSON.parse(sessionStorage.getItem('_cb_preserved_input'))?.content).toBe(
        'first message',
      )
    })

    // Recovery already lives in composer restoration (_cb_preserved_input) - queueing too
    // would risk a double send once the container reconnects.
    expect(result.current.queue.queueItems).toHaveLength(0)
  })
})

describe('useChatController first message of a new session', () => {
  const PROPS = {
    events: [],
    contextRefs: {
      chatScrollPositionRef: { current: 0 },
      chatAutoScrollEnabledRef: { current: true },
    },
  }
  const created = sessionId => ({
    current: 1,
    bySeq: { 1: { status: 'created', sessionId, fromRoute: null } },
  })

  let sendMessage

  beforeEach(async () => {
    ;({ sendMessage } = await import('../../../api/chat'))
    sendMessage.mockClear()
    sendMessage.mockResolvedValue({})
    clearStoredState()
    mockApplyingPicks = false
    // Welcome screen: a creation is in flight, nothing routed or attached.
    mockSessionId = null
    mockRoutedSessionId = null
    mockIsConnected = false
    mockCreatePending = true
    mockCreations = {
      current: 1,
      bySeq: { 1: { status: 'pending', sessionId: null, fromRoute: null } },
    }
  })

  function deferFirstMessage() {
    const hook = renderHook(() => useChatController(PROPS))
    act(() => {
      hook.result.current.deferred.deferSend('first message for C', [])
    })
    return hook
  }

  it('sends nothing into B when B is opened before the new session connects', async () => {
    const { rerender } = deferFirstMessage()

    // C -> nothing -> B: the creation produced C, but the reader opened B, which connects first.
    mockCreatePending = false
    mockCreations = created('C')
    mockRoutedSessionId = 'B'
    rerender()
    mockSessionId = 'B'
    mockIsConnected = true
    rerender()

    await Promise.resolve()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends nothing into B on a direct C -> B change', async () => {
    const { rerender } = deferFirstMessage()

    mockCreatePending = false
    mockCreations = created('C')
    mockSessionId = 'C'
    rerender()
    mockRoutedSessionId = 'B'
    mockSessionId = 'B'
    mockIsConnected = true
    rerender()

    await Promise.resolve()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends it exactly once when the reader returns to its own session', async () => {
    const { rerender } = deferFirstMessage()
    mockCreatePending = false
    mockCreations = created('C')
    mockRoutedSessionId = 'B'
    mockSessionId = 'B'
    mockIsConnected = true
    rerender()

    mockRoutedSessionId = 'C'
    mockSessionId = 'C'
    rerender()
    rerender()

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(sendMessage.mock.calls[0][0]).toBe('first message for C')
  })

  it('sends into its own session while the tab is already being re-addressed to B', async () => {
    const actual = await vi.importActual('../../../api/chat')
    sendMessage.mockImplementation(actual.sendMessage)
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    setWorkspaceId('ws')

    try {
      const { rerender } = deferFirstMessage()
      // Opening B moves the tab's address before the render that clears C's view commits.
      setAddress('container-b', 'B')
      mockCreatePending = false
      mockCreations = created('C')
      mockSessionId = 'C'
      mockContainerId = 'container-c'
      mockIsConnected = true
      rerender()

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
      expect(fetchMock.mock.calls[0][0]).toBe(
        '/api/workspaces/ws/containers/container-c/api/send?session_id=C',
      )
    } finally {
      vi.unstubAllGlobals()
      setAddress(null, null)
      mockContainerId = null
    }
  })

  it('waits for the welcome picks to reach the new session before sending into it', async () => {
    const { rerender } = deferFirstMessage()
    mockCreatePending = false
    mockCreations = created('C')
    mockSessionId = 'C'
    mockIsConnected = true
    mockApplyingPicks = true
    rerender()

    await Promise.resolve()
    expect(sendMessage).not.toHaveBeenCalled()

    mockApplyingPicks = false
    rerender()

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
  })
})

describe('useChatController input typed while a session is created', () => {
  const PROPS = {
    events: [],
    contextRefs: {
      chatScrollPositionRef: { current: 0 },
      chatAutoScrollEnabledRef: { current: true },
    },
  }
  const creation = (seq, status, sessionId = null, fromRoute = 'A') => ({
    current: seq,
    bySeq: { [seq]: { status, sessionId, fromRoute } },
  })

  let sendMessage

  beforeEach(async () => {
    ;({ sendMessage } = await import('../../../api/chat'))
    sendMessage.mockClear()
    sendMessage.mockResolvedValue({})
    clearStoredState()
    mockApplyingPicks = false
    // In A, New session: the creation runs while A's own data comes back on a refresh.
    mockSessionId = 'A'
    mockRoutedSessionId = 'A'
    mockIsConnected = true
    mockCreatePending = true
    mockCreations = creation(1, 'pending')
  })

  function typeDuringCreation() {
    const hook = renderHook(() => useChatController(PROPS))
    act(() => {
      hook.result.current.deferred.deferSend('first for new', [])
      hook.result.current.queue.enqueueMessage('queued for new', [{ id: 'f1', name: 'a.txt' }])
    })
    return hook
  }

  it('hands everything back and sends nothing into A when the creation fails', async () => {
    const { result, rerender } = typeDuringCreation()

    mockCreatePending = false
    mockCreations = creation(1, 'failed')
    rerender()

    await vi.waitFor(() => {
      expect(result.current.deferred.returnedInput).toEqual({
        rawPrompt: 'first for new\n\nqueued for new',
        currentAttachments: [{ id: 'f1', name: 'a.txt' }],
      })
    })
    expect(result.current.deferred.deferredSend).toBeNull()
    expect(result.current.queue.queueItems).toEqual([])
    expect(localStorage.getItem('queue:A')).toBeNull()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends and queues only in the session the creation produced', async () => {
    const { result, rerender } = typeDuringCreation()
    expect(localStorage.getItem('queue:A')).toBeNull()

    mockCreatePending = false
    mockCreations = creation(1, 'created', 'C')
    mockSessionId = 'C'
    rerender()

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(sendMessage.mock.calls[0][0]).toBe('first for new')
    expect(JSON.parse(localStorage.getItem('queue:C')).map(i => i.content)).toEqual([
      'queued for new',
    ])
    expect(localStorage.getItem('queue:A')).toBeNull()
    expect(result.current.deferred.returnedInput).toBeNull()
  })

  it('sends only the retry as the next first message after a welcome failure', async () => {
    mockSessionId = null
    mockRoutedSessionId = null
    mockIsConnected = false
    mockCreations = creation(1, 'pending', null, null)
    const { result, rerender } = renderHook(() => useChatController(PROPS))
    act(() => {
      result.current.deferred.deferSend('first try', [])
    })
    mockCreatePending = false
    mockCreations = creation(1, 'failed', null, null)
    rerender()
    await vi.waitFor(() => {
      expect(result.current.deferred.returnedInput?.rawPrompt).toBe('first try')
    })
    act(() => {
      result.current.deferred.clearReturnedInput()
    })

    mockCreatePending = true
    mockCreations = {
      current: 2,
      bySeq: { ...mockCreations.bySeq, 2: { status: 'pending', sessionId: null, fromRoute: null } },
    }
    rerender()
    act(() => {
      result.current.deferred.deferSend('second try', [])
    })
    mockCreatePending = false
    mockCreations = {
      current: 2,
      bySeq: { ...mockCreations.bySeq, 2: { status: 'created', sessionId: 'C', fromRoute: null } },
    }
    mockSessionId = 'C'
    mockIsConnected = true
    rerender()

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(sendMessage.mock.calls[0][0]).toBe('second try')
    expect(result.current.queue.queueItems).toEqual([])
  })
})
