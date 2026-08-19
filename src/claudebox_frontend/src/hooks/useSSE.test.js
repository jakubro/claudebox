/** Tests for useSSE - React wrapper wiring SSEConnectionManager lifecycle to component state. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useSSE from './useSSE'

const mockInstances = []
vi.mock('../managers/SSEConnectionManager', () => {
  class MockSSEConnectionManager {
    constructor(opts) {
      this.opts = opts
      this.connect = vi.fn()
      this.disconnect = vi.fn()
      this.close = vi.fn()
      this.reconnect = vi.fn()
      mockInstances.push(this)
    }
  }
  return { default: MockSSEConnectionManager }
})

describe('useSSE', () => {
  beforeEach(() => {
    mockInstances.length = 0
  })

  it('creates no manager and stays disconnected without a url', () => {
    const { result } = renderHook(() => useSSE({ onMessage: vi.fn(), url: null }))

    expect(mockInstances).toHaveLength(0)
    expect(result.current.connectionStatus).toBe('disconnected')
  })

  it('creates and connects a manager for a given url', () => {
    renderHook(() => useSSE({ onMessage: vi.fn(), url: 'http://x/sse' }))

    expect(mockInstances).toHaveLength(1)
    expect(mockInstances[0].opts.url).toBe('http://x/sse')
    expect(mockInstances[0].connect).toHaveBeenCalledTimes(1)
  })

  it('closes the manager and resets state when the url is cleared', () => {
    const { result, rerender } = renderHook(({ url }) => useSSE({ onMessage: vi.fn(), url }), {
      initialProps: { url: 'http://x/sse' },
    })
    const instance = mockInstances[0]

    act(() => {
      instance.opts.onStatusChange('connected', 'stale error')
    })
    expect(result.current.connectionStatus).toBe('connected')

    rerender({ url: null })

    // Effect cleanup closes the outgoing manager, then the no-url branch closes it again
    // via managerRef (cleanup does not null the ref) before nulling it out itself.
    expect(instance.close).toHaveBeenCalledTimes(2)
    expect(result.current.connectionStatus).toBe('disconnected')
    expect(result.current.connectionError).toBeNull()
  })

  it('disconnects and closes the previous manager, then creates a new one on url change', () => {
    const { rerender } = renderHook(({ url }) => useSSE({ onMessage: vi.fn(), url }), {
      initialProps: { url: 'http://a' },
    })
    const first = mockInstances[0]

    rerender({ url: 'http://b' })

    // Effect cleanup closes the outgoing manager; the new run's own guard then disconnects
    // it again via managerRef before replacing the ref with the freshly created manager.
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(first.disconnect).toHaveBeenCalledTimes(1)
    expect(mockInstances).toHaveLength(2)
    expect(mockInstances[1].opts.url).toBe('http://b')
    expect(mockInstances[1].connect).toHaveBeenCalledTimes(1)
  })

  it('closes the manager on unmount', () => {
    const { unmount } = renderHook(() => useSSE({ onMessage: vi.fn(), url: 'http://x' }))
    const instance = mockInstances[0]

    unmount()

    expect(instance.close).toHaveBeenCalledTimes(1)
  })

  it('propagates status and error changes into hook state', () => {
    const { result } = renderHook(() => useSSE({ onMessage: vi.fn(), url: 'http://x' }))
    const instance = mockInstances[0]

    act(() => {
      instance.opts.onStatusChange('reconnecting', 'connection lost')
    })

    expect(result.current.connectionStatus).toBe('reconnecting')
    expect(result.current.connectionError).toBe('connection lost')
  })

  it('routes manager messages through the latest onMessage callback', () => {
    const firstHandler = vi.fn()
    const { rerender } = renderHook(({ onMessage }) => useSSE({ onMessage, url: 'http://x' }), {
      initialProps: { onMessage: firstHandler },
    })
    const instance = mockInstances[0]
    const event = { data: 'one' }

    instance.opts.onMessage(event)
    expect(firstHandler).toHaveBeenCalledWith(event)

    // Same url - manager is not recreated, but the ref should track the newest callback.
    const secondHandler = vi.fn()
    rerender({ onMessage: secondHandler })
    expect(mockInstances).toHaveLength(1)

    const secondEvent = { data: 'two' }
    instance.opts.onMessage(secondEvent)
    expect(secondHandler).toHaveBeenCalledWith(secondEvent)
    expect(firstHandler).toHaveBeenCalledTimes(1)
  })

  it('routes reconnect-exhausted through the latest callback', () => {
    const onExhausted = vi.fn()
    renderHook(() =>
      useSSE({ onMessage: vi.fn(), url: 'http://x', onReconnectExhausted: onExhausted }),
    )
    const instance = mockInstances[0]

    instance.opts.onReconnectExhausted()

    expect(onExhausted).toHaveBeenCalledTimes(1)
  })

  it('tolerates a missing onMessage/onReconnectExhausted callback', () => {
    renderHook(() => useSSE({ url: 'http://x' }))
    const instance = mockInstances[0]

    expect(() => instance.opts.onMessage({ data: 'x' })).not.toThrow()
    expect(() => instance.opts.onReconnectExhausted()).not.toThrow()
  })

  it('exposes reconnectSSE/disconnectSSE/closeSSE delegating to the manager', () => {
    const { result } = renderHook(() => useSSE({ onMessage: vi.fn(), url: 'http://x' }))
    const instance = mockInstances[0]

    act(() => result.current.reconnectSSE())
    expect(instance.reconnect).toHaveBeenCalledTimes(1)

    act(() => result.current.disconnectSSE())
    expect(instance.disconnect).toHaveBeenCalledTimes(1)

    act(() => result.current.closeSSE())
    expect(instance.close).toHaveBeenCalledTimes(1)

    // closeSSE clears the manager ref, so a second call cannot re-close the old instance.
    act(() => result.current.closeSSE())
    expect(instance.close).toHaveBeenCalledTimes(1)
  })

  it('reconnectSSE/disconnectSSE are no-ops before any manager exists', () => {
    const { result } = renderHook(() => useSSE({ onMessage: vi.fn(), url: null }))

    expect(() => {
      act(() => {
        result.current.reconnectSSE()
        result.current.disconnectSSE()
        result.current.closeSSE()
      })
    }).not.toThrow()
  })
})
