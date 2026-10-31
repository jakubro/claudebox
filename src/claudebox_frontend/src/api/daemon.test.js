/** Tests for daemon.js - reading the daemon's commit from its health. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDaemonCommit } from './daemon'

describe('fetchDaemonCommit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['a commit', { ok: true, json: async () => ({ status: 'ok', commit: '4a82dc0' }) }, '4a82dc0'],
    ['a null commit', { ok: true, json: async () => ({ status: 'ok', commit: null }) }, null],
    ['a failed request', { ok: false, json: async () => ({}) }, null],
    ['a body that is not JSON', { ok: true, json: async () => JSON.parse('<html>') }, null],
  ])('answers %s', async (_label, response, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    expect(await fetchDaemonCommit()).toBe(expected)
  })

  it('answers null when the daemon cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect(await fetchDaemonCommit()).toBeNull()
  })
})
