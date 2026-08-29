/** Tests for apiClient fetch wrappers and retry logic. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/timing', () => ({
  FETCH_RETRY_MAX_ATTEMPTS: 3,
  FETCH_RETRY_BASE_DELAY_MS: 10,
  FETCH_RETRY_MAX_DELAY_MS: 100,
  // Deliberately distinct so a test can tell which tier reached fetch.
  FETCH_TIMEOUT_ACTION_MS: 400,
  FETCH_TIMEOUT_LISTING_MS: 40,
}))

import {
  containerFetch,
  containerUrl,
  getContainerId,
  getWorkspaceId,
  retryFetch,
  setContainerId,
  setWorkspaceId,
  workspaceFetch,
} from './apiClient'

describe('retryFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** Advance all pending timers (retry delays) without blocking. */
  async function drainTimers() {
    await vi.advanceTimersByTimeAsync(200)
  }

  it('returns response on first success', async () => {
    const response = { ok: true, status: 200 }
    fetch.mockResolvedValue(response)

    const result = await retryFetch('/api/test')

    expect(result).toBe(response)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('retries on TypeError and succeeds', async () => {
    fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const promise = retryFetch('/api/test')
    await drainTimers()
    const result = await promise

    expect(result.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 502 and succeeds', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const promise = retryFetch('/api/test')
    await drainTimers()
    const result = await promise

    expect(result.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 503 and succeeds', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const promise = retryFetch('/api/test')
    await drainTimers()
    const result = await promise

    expect(result.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 504 and succeeds', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 504 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const promise = retryFetch('/api/test')
    await drainTimers()
    const result = await promise

    expect(result.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries on TypeError', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const promise = retryFetch('/api/test').catch(e => e)
    await drainTimers()
    const error = await promise

    expect(error).toBeInstanceOf(TypeError)
    expect(error.message).toBe('Failed to fetch')
    expect(fetch).toHaveBeenCalledTimes(4) // 1 initial + 3 retries
  })

  it('returns last response after max retries on retryable HTTP status', async () => {
    const badResponse = { ok: false, status: 502 }
    fetch.mockResolvedValue(badResponse)

    const promise = retryFetch('/api/test')
    await drainTimers()
    const result = await promise

    expect(result).toBe(badResponse)
    expect(fetch).toHaveBeenCalledTimes(4) // 1 initial + 3 retries
  })

  it('does not retry on non-retryable errors', async () => {
    fetch.mockRejectedValue(new Error('AbortError'))

    await expect(retryFetch('/api/test')).rejects.toThrow('AbortError')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not retry on non-retryable HTTP status', async () => {
    const response = { ok: false, status: 400 }
    fetch.mockResolvedValue(response)

    const result = await retryFetch('/api/test')

    expect(result).toBe(response)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not retry on 404', async () => {
    const response = { ok: false, status: 404 }
    fetch.mockResolvedValue(response)

    const result = await retryFetch('/api/test')

    expect(result).toBe(response)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('passes options through to fetch', async () => {
    fetch.mockResolvedValue({ ok: true })
    const options = { method: 'POST', body: '{}' }

    await retryFetch('/api/test', options)

    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
  })

  it('bounds every attempt with an abort signal', async () => {
    fetch.mockResolvedValue({ ok: true })

    await retryFetch('/api/test')

    const [, init] = fetch.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('composes the bound with a caller signal rather than replacing it', async () => {
    fetch.mockResolvedValue({ ok: true })
    const controller = new AbortController()

    await retryFetch('/api/test', { signal: controller.signal })

    const [, init] = fetch.mock.calls[0]
    expect(init.signal).not.toBe(controller.signal)

    controller.abort()
    expect(init.signal.aborted).toBe(true)
  })

  it('applies exponential backoff between retries', async () => {
    fetch
      .mockRejectedValueOnce(new TypeError('net'))
      .mockRejectedValueOnce(new TypeError('net'))
      .mockRejectedValueOnce(new TypeError('net'))
      .mockResolvedValueOnce({ ok: true })

    const promise = retryFetch('/api/test')

    // After 10ms (base delay * 2^0), first retry fires
    await vi.advanceTimersByTimeAsync(10)
    expect(fetch).toHaveBeenCalledTimes(2)

    // After 20ms more (base delay * 2^1), second retry fires
    await vi.advanceTimersByTimeAsync(20)
    expect(fetch).toHaveBeenCalledTimes(3)

    // After 40ms more (base delay * 2^2), third retry fires
    await vi.advanceTimersByTimeAsync(40)
    expect(fetch).toHaveBeenCalledTimes(4)

    const result = await promise
    expect(result.ok).toBe(true)
  })
})

describe('workspaceFetch', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })
    setWorkspaceId('ws-1')
    setContainerId(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setWorkspaceId(null)
  })

  it('prefixes path with workspace', async () => {
    await workspaceFetch('/sessions')

    expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws-1/sessions', expect.any(Object))
  })

  it('throws when workspace ID not set', () => {
    setWorkspaceId(null)

    expect(() => workspaceFetch('/sessions')).toThrow('Workspace ID not set')
  })
})

describe('containerFetch', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })
    setWorkspaceId('ws-1')
    setContainerId('c-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setWorkspaceId(null)
    setContainerId(null)
  })

  it('prefixes path with workspace and container', async () => {
    await containerFetch('/api/send')

    expect(fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/containers/c-1/api/send',
      expect.any(Object),
    )
  })

  it('throws when workspace ID not set', () => {
    setWorkspaceId(null)

    expect(() => containerFetch('/api/send')).toThrow('Workspace ID not set')
  })

  it('throws when container ID not set', () => {
    setContainerId(null)

    expect(() => containerFetch('/api/send')).toThrow('Container ID not set')
  })

  it('addresses an explicit container, ignoring the module default', async () => {
    await containerFetch('/api/send', undefined, 'c-other')

    expect(fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/containers/c-other/api/send',
      expect.any(Object),
    )
  })

  it('an explicit container id still requires a workspace id', () => {
    setWorkspaceId(null)

    expect(() => containerFetch('/api/send', undefined, 'c-other')).toThrow('Workspace ID not set')
  })
})

describe('containerUrl', () => {
  beforeEach(() => {
    setWorkspaceId('ws-1')
    setContainerId('c-1')
  })

  afterEach(() => {
    setWorkspaceId(null)
    setContainerId(null)
  })

  it('builds proxied URL', () => {
    expect(containerUrl('/api/stream')).toBe('/api/workspaces/ws-1/containers/c-1/api/stream')
  })

  it('builds a proxied URL for an explicit container, ignoring the module default', () => {
    expect(containerUrl('/api/stream', 'c-other')).toBe(
      '/api/workspaces/ws-1/containers/c-other/api/stream',
    )
  })
})

describe('state accessors', () => {
  afterEach(() => {
    setWorkspaceId(null)
    setContainerId(null)
  })

  it('get/set workspace ID', () => {
    setWorkspaceId('w')
    expect(getWorkspaceId()).toBe('w')
  })

  it('get/set container ID', () => {
    setContainerId('c')
    expect(getContainerId()).toBe('c')
  })
})

// Real timers: AbortSignal.timeout runs off its own internal clock, which fake timers do not drive.
describe('bounds reaching fetch', () => {
  /** Honours the abort contract the real fetch has, so a fired bound is observable. */
  function hangingFetch() {
    return vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason))
        }),
    )
  }

  beforeEach(() => {
    globalThis.fetch = hangingFetch()
    setWorkspaceId('ws-1')
    setContainerId('c-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setWorkspaceId(null)
    setContainerId(null)
  })

  it('rejects with a timeout once the bound expires, without retrying', async () => {
    const error = await workspaceFetch('/sessions').catch(e => e)

    expect(error.name).toBe('TimeoutError')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('applies the listing tier to workspaceFetch and the action tier to containerFetch', async () => {
    const listing = workspaceFetch('/sessions').catch(() => 'listing')
    const action = containerFetch('/api/send').catch(() => 'action')

    // The listing tier is an order of magnitude shorter, so it must lose the race outright.
    expect(await Promise.race([listing, action])).toBe('listing')
  })

  it('lets a call-site timeoutMs override the wrapper default', async () => {
    const override = containerFetch('/api/send', { timeoutMs: 20 }).catch(() => 'override')
    const wrapperDefault = workspaceFetch('/sessions').catch(() => 'wrapper-default')

    expect(await Promise.race([override, wrapperDefault])).toBe('override')
  })
})
