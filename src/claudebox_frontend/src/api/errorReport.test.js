/** Tests for api/errorReport.js best-effort failure reporting. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_REPORT_DEDUP_WINDOW_MS } from '../config/timing'
import { reportError } from './errorReport'

describe('reportError', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('posts kind, message, and stack_trace to the daemon report endpoint', () => {
    reportError({ kind: 'render-failure', message: 'todos: boom', stack: 'at Todos' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/daemon/report',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.kind).toBe('render-failure')
    expect(body.message).toBe('todos: boom')
    expect(body.stack_trace).toBe('at Todos')
    expect(body.app_version).toBeNull()
    expect(typeof body.client_timestamp).toBe('string')
  })

  it('defaults a missing stack to null', () => {
    reportError({ kind: 'persistence-failure', message: 'quota exceeded' })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.stack_trace).toBeNull()
  })

  it('never throws when the daemon is unreachable', () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    expect(() => reportError({ kind: 'render-failure', message: 'unreachable-1' })).not.toThrow()
  })

  it('deduplicates an identical signature within the window', () => {
    reportError({ kind: 'render-failure', message: 'dedup-1' })
    reportError({ kind: 'render-failure', message: 'dedup-1' })

    expect(fetch).toHaveBeenCalledOnce()
  })

  it('reports again once the dedup window elapses', () => {
    reportError({ kind: 'render-failure', message: 'dedup-2' })
    vi.advanceTimersByTime(ERROR_REPORT_DEDUP_WINDOW_MS + 1)
    reportError({ kind: 'render-failure', message: 'dedup-2' })

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not deduplicate across different signatures', () => {
    reportError({ kind: 'render-failure', message: 'dedup-3a' })
    reportError({ kind: 'render-failure', message: 'dedup-3b' })

    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
