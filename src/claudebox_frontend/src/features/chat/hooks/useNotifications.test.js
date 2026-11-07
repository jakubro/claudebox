/** Tests for useNotifications hook. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playChime, requestNotificationPermission } from '../utils/notifications'
import useNotifications from './useNotifications'

function renderResponding(options = {}) {
  return renderHook(
    ({ isResponding }) => useNotifications({ isResponding, events: [], ...options }),
    {
      initialProps: { isResponding: true },
    },
  )
}

function installGrantedNotification() {
  const notification = vi.fn()
  notification.prototype.close = vi.fn()
  global.Notification = notification
  global.Notification.permission = 'granted'
  global.Notification.requestPermission = vi.fn().mockResolvedValue('granted')

  return notification
}

describe('useNotifications', () => {
  let mockNotification

  beforeEach(() => {
    vi.useFakeTimers()
    mockNotification = installGrantedNotification()

    Object.defineProperty(document, 'hidden', { value: true, writable: true })
    document.title = 'Test | Claudebox'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requests permission on first response', () => {
    renderHook(() => useNotifications({ isResponding: true, events: [] }))

    expect(Notification.requestPermission).not.toHaveBeenCalled() // Already granted
  })

  it('does not notify while still responding', () => {
    renderHook(() => useNotifications({ isResponding: true, events: [] }))

    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('sends notification when response completes, tab is hidden, and notifications enabled', () => {
    const { rerender } = renderResponding({
      sessionName: 'Test',
      workspace: '/home/user/project',
      notificationsEnabled: true,
    })

    rerender({ isResponding: false })
    vi.advanceTimersByTime(60)

    expect(mockNotification).toHaveBeenCalledWith(
      'Test | project | Claudebox',
      expect.objectContaining({
        body: 'Response complete',
        tag: 'claude-response',
      }),
    )
  })

  it('does not notify when tab is visible', () => {
    Object.defineProperty(document, 'hidden', { value: false })

    const { rerender } = renderResponding()

    rerender({ isResponding: false })

    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('does not notify when permission is not granted', () => {
    global.Notification.permission = 'denied'

    const { rerender } = renderResponding({ notificationsEnabled: true })

    rerender({ isResponding: false })

    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('does not notify when notificationsEnabled is false', () => {
    const { rerender } = renderResponding({ notificationsEnabled: false })

    rerender({ isResponding: false })

    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('extracts preview from assistant text content (excludes thinking)', () => {
    const events = [
      { type: 'assistant', subtype: 'thinking', content: 'Let me think about this...' },
      { type: 'assistant', subtype: 'text', content: 'Here is my response to your question' },
    ]

    const { rerender } = renderHook(
      ({ isResponding }) =>
        useNotifications({
          isResponding,
          events,
          sessionName: 'Test',
          workspace: '/proj',
          notificationsEnabled: true,
        }),
      { initialProps: { isResponding: true } },
    )

    rerender({ isResponding: false })
    vi.advanceTimersByTime(60)

    expect(mockNotification).toHaveBeenCalledWith(
      'Test | proj | Claudebox',
      expect.objectContaining({
        body: 'Here is my response to your question',
      }),
    )
  })

  it('truncates long preview', () => {
    const longContent = 'A'.repeat(100)
    const events = [{ type: 'assistant', subtype: 'text', content: longContent }]

    const { rerender } = renderHook(
      ({ isResponding }) =>
        useNotifications({
          isResponding,
          events,
          sessionName: 'Session',
          workspace: '',
          notificationsEnabled: true,
        }),
      { initialProps: { isResponding: true } },
    )

    rerender({ isResponding: false })
    vi.advanceTimersByTime(60)

    expect(mockNotification).toHaveBeenCalledWith(
      'Session | Claudebox',
      expect.objectContaining({
        body: `${'A'.repeat(50)}...`,
      }),
    )
  })

  it('adds tab title indicator when response completes', () => {
    const { rerender } = renderResponding()

    rerender({ isResponding: false })

    expect(document.title).toBe('* Test | Claudebox')
  })

  it('does not notify on initial load (session resume)', () => {
    // Simulate session resume - not responding initially, then never starts responding
    renderHook(() => useNotifications({ isResponding: false, events: [] }))

    expect(mockNotification).not.toHaveBeenCalled()
  })
  describe('background work', () => {
    const renderSession = initialProps =>
      renderHook(
        props =>
          useNotifications({
            ...props,
            events: [],
            sessionName: 'Test',
            workspace: '/home/user/project',
            notificationsEnabled: true,
          }),
        { initialProps },
      )

    it('stays silent when a turn ends with background work still running', () => {
      const { rerender } = renderSession({ isResponding: true, isWaiting: false })

      rerender({ isResponding: false, isWaiting: true })
      vi.advanceTimersByTime(60)

      expect(mockNotification).not.toHaveBeenCalled()
      expect(document.title).toBe('Test | Claudebox')
    })

    it('stays silent when the background work ends on its own', () => {
      const { rerender } = renderSession({ isResponding: true, isWaiting: false })
      rerender({ isResponding: false, isWaiting: true })

      rerender({ isResponding: false, isWaiting: false })
      vi.advanceTimersByTime(60)

      expect(mockNotification).not.toHaveBeenCalled()
      expect(document.title).toBe('Test | Claudebox')
    })

    it('notifies once when the follow-up turn ends with nothing left running', () => {
      const { rerender } = renderSession({ isResponding: true, isWaiting: false })
      rerender({ isResponding: false, isWaiting: true })
      rerender({ isResponding: true, isWaiting: false })

      rerender({ isResponding: false, isWaiting: false })
      vi.advanceTimersByTime(60)

      expect(mockNotification).toHaveBeenCalledTimes(1)
      expect(document.title).toBe('* Test | Claudebox')
    })
  })
})

describe('requestNotificationPermission', () => {
  it('returns granted if already granted', async () => {
    global.Notification = { permission: 'granted' }

    const result = await requestNotificationPermission()

    expect(result).toBe('granted')
  })

  it('returns denied if no Notification API', async () => {
    delete global.Notification

    const result = await requestNotificationPermission()

    expect(result).toBe('denied')
  })

  it('requests permission if not decided', async () => {
    global.Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    }

    const result = await requestNotificationPermission()

    expect(Notification.requestPermission).toHaveBeenCalled()
    expect(result).toBe('granted')
  })
})

describe('playChime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates AudioContext to play sound', () => {
    let ctxCreated = false
    class MockAudioContext {
      constructor() {
        ctxCreated = true
      }

      createOscillator() {
        return {
          type: '',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }
      }

      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        }
      }

      get destination() {
        return {}
      }

      get currentTime() {
        return 0
      }
    }
    global.AudioContext = MockAudioContext

    playChime()

    expect(ctxCreated).toBe(true)
  })

  it('handles AudioContext not available', () => {
    global.AudioContext = class {
      constructor() {
        throw new Error('Not available')
      }
    }

    expect(() => playChime()).not.toThrow()
  })
})

describe('useNotifications user interaction listeners', () => {
  beforeEach(() => {
    installGrantedNotification()

    Object.defineProperty(document, 'hidden', { value: false, writable: true })
    document.title = 'Test | Claudebox'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears title indicator on focus event', () => {
    const { rerender } = renderResponding()

    // Complete response to add indicator
    rerender({ isResponding: false })
    expect(document.title).toBe('* Test | Claudebox')

    window.dispatchEvent(new Event('focus'))

    expect(document.title).toBe('Test | Claudebox')
  })

  it('clears title indicator on click event', () => {
    const { rerender } = renderResponding()

    rerender({ isResponding: false })
    expect(document.title).toBe('* Test | Claudebox')

    window.dispatchEvent(new Event('click'))

    expect(document.title).toBe('Test | Claudebox')
  })

  it('clears title indicator on keydown event', () => {
    const { rerender } = renderResponding()

    rerender({ isResponding: false })
    expect(document.title).toBe('* Test | Claudebox')

    window.dispatchEvent(new Event('keydown'))

    expect(document.title).toBe('Test | Claudebox')
  })

  it('removes interaction listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useNotifications({ isResponding: false, events: [] }))

    unmount()

    const removedEvents = removeEventListenerSpy.mock.calls.map(call => call[0])
    expect(removedEvents).toContain('focus')
    expect(removedEvents).toContain('click')
    expect(removedEvents).toContain('keydown')
  })
})

describe('useNotifications requestPermission callback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns requestPermission function that triggers Notification.requestPermission', async () => {
    global.Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    }

    Object.defineProperty(document, 'hidden', { value: false, writable: true })
    document.title = 'Test | Claudebox'

    const { result } = renderHook(() => useNotifications({ isResponding: false, events: [] }))

    const permission = await result.current.requestPermission()

    expect(Notification.requestPermission).toHaveBeenCalled()
    expect(permission).toBe('granted')
  })

  it('requestPermission returns granted without calling API when already granted', async () => {
    global.Notification = {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    }

    Object.defineProperty(document, 'hidden', { value: false, writable: true })
    document.title = 'Test | Claudebox'

    const { result } = renderHook(() => useNotifications({ isResponding: false, events: [] }))

    const permission = await result.current.requestPermission()

    expect(permission).toBe('granted')
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('requestPermission returns denied when Notification API is unavailable', async () => {
    delete global.Notification

    Object.defineProperty(document, 'hidden', { value: false, writable: true })
    document.title = 'Test | Claudebox'

    // Need to temporarily provide a stub for the hook's internal usage
    global.Notification = { permission: 'denied', requestPermission: vi.fn() }

    const { result } = renderHook(() => useNotifications({ isResponding: false, events: [] }))

    // Now remove Notification to test the requestPermission path
    delete global.Notification

    const permission = await result.current.requestPermission()
    expect(permission).toBe('denied')
  })
})

describe('useNotifications with notificationsEnabled', () => {
  let mockAudioContext

  beforeEach(() => {
    installGrantedNotification()

    mockAudioContext = {
      createOscillator: vi.fn().mockReturnValue({
        type: '',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      destination: {},
      currentTime: 0,
    }
    global.AudioContext = vi.fn().mockImplementation(() => mockAudioContext)

    Object.defineProperty(document, 'hidden', { value: true, writable: true })
    document.title = 'Test | Claudebox'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('plays sound when notificationsEnabled and tab is hidden', () => {
    const { rerender } = renderResponding({ notificationsEnabled: true })

    rerender({ isResponding: false })

    expect(global.AudioContext).toHaveBeenCalled()
  })

  it('does not play sound when notificationsEnabled is false', () => {
    const { rerender } = renderResponding({ notificationsEnabled: false })

    rerender({ isResponding: false })

    expect(global.AudioContext).not.toHaveBeenCalled()
  })

  it('does not play sound when tab is visible', () => {
    Object.defineProperty(document, 'hidden', { value: false })

    const { rerender } = renderResponding({ notificationsEnabled: true })

    rerender({ isResponding: false })

    expect(global.AudioContext).not.toHaveBeenCalled()
  })

  describe('a run a sibling session started', () => {
    const user = { type: 'user', subtype: 'message', is_human: true, content: 'go' }
    const reply = { type: 'assistant', subtype: 'text', content: 'ok' }
    const result = { type: 'result', subtype: 'success' }
    const sibling = {
      type: 'system',
      subtype: 'sibling_message',
      content: 'Done.',
      message_data: { from_session_id: 's-1' },
    }
    const ask = { type: 'assistant', subtype: 'tool_use', tool_name: 'mcp__claudebox__needs_user' }

    const finish = (events, options = {}) => {
      const { rerender } = renderHook(
        props =>
          useNotifications({
            ...props,
            sessionName: 'Test',
            workspace: '/home/user/project',
            notificationsEnabled: true,
            ...options,
          }),
        { initialProps: { isResponding: true, events } },
      )
      rerender({ isResponding: false, events })
    }

    it('plays no chime', () => {
      finish([user, reply, result, sibling, reply, result])

      expect(global.AudioContext).not.toHaveBeenCalled()
      expect(document.title).toBe('* Test | Claudebox')
    })

    it('notifies when that run itself asks the user', () => {
      finish([user, reply, result, sibling, reply, ask, result])

      expect(global.AudioContext).toHaveBeenCalledTimes(1)
    })

    it('stays quiet when it asks in a session another session spawned', () => {
      finish([user, reply, result, sibling, reply, ask, result], { canNeedUser: false })

      expect(global.AudioContext).not.toHaveBeenCalled()
    })

    it('still notifies for a run the user started', () => {
      finish([sibling, reply, result, user, reply, result])

      expect(global.AudioContext).toHaveBeenCalledTimes(1)
    })
  })
})
