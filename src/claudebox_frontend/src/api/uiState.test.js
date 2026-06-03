/** Tests for api/uiState.js UI state persistence via daemon. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUiState, patchGlobalUiState, patchSessionUiState, patchUiState } from './uiState'

const mockWorkspaceFetch = vi.fn()

vi.mock('./apiClient', () => ({
  workspaceFetch: (...args) => mockWorkspaceFetch(...args),
}))

describe('getUiState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches global UI state without session', async () => {
    const data = { global: {}, session: {} }
    mockWorkspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await getUiState()

    expect(mockWorkspaceFetch).toHaveBeenCalledWith('/ui-state')
    expect(result).toEqual(data)
  })

  it('fetches with session_id query param when provided', async () => {
    const data = { global: {}, session: { key: 'val' } }
    mockWorkspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await getUiState('sess-1')

    expect(mockWorkspaceFetch).toHaveBeenCalledWith('/ui-state?session_id=sess-1')
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    mockWorkspaceFetch.mockResolvedValue({ ok: false })

    await expect(getUiState()).rejects.toThrow('Failed to fetch ui-state')
  })
})

describe('patchUiState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with data (fire-and-forget)', () => {
    mockWorkspaceFetch.mockResolvedValue({ ok: true })

    patchUiState(null, { global: [{ op: 'set', path: 'key', value: 'v' }] })

    expect(mockWorkspaceFetch).toHaveBeenCalledWith('/ui-state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ global: [{ op: 'set', path: 'key', value: 'v' }] }),
    })
  })

  it('includes session_id in URL when provided', () => {
    mockWorkspaceFetch.mockResolvedValue({ ok: true })

    patchUiState('sess-1', { session: [{ op: 'set', path: 'a', value: 1 }] })

    expect(mockWorkspaceFetch).toHaveBeenCalledWith(
      '/ui-state?session_id=sess-1',
      expect.any(Object),
    )
  })

  it('swallows errors silently', async () => {
    mockWorkspaceFetch.mockRejectedValue(new Error('Network'))

    // Should not throw
    patchUiState(null, { global: [] })

    // Wait for promise to settle
    await vi.waitFor(() => {
      expect(mockWorkspaceFetch).toHaveBeenCalledOnce()
    })
  })
})

describe('patchGlobalUiState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to patchUiState with global scope', () => {
    mockWorkspaceFetch.mockResolvedValue({ ok: true })
    const ops = [{ op: 'set', path: 'theme', value: 'dark' }]

    patchGlobalUiState(ops)

    const call = mockWorkspaceFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.global).toEqual(ops)
  })
})

describe('patchSessionUiState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to patchUiState with session scope and session_id', () => {
    mockWorkspaceFetch.mockResolvedValue({ ok: true })
    const ops = [{ op: 'set', path: 'collapsed', value: true }]

    patchSessionUiState('sess-1', ops)

    expect(mockWorkspaceFetch).toHaveBeenCalledWith(
      '/ui-state?session_id=sess-1',
      expect.any(Object),
    )
    const call = mockWorkspaceFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.session).toEqual(ops)
  })
})
