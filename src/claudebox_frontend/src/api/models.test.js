/** Tests for api/models.js model switching. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setModel } from './models'

vi.mock('./apiClient', async importOriginal => ({
  ...(await importOriginal()),
  containerFetch: vi.fn(),
}))

import { containerFetch, setAddress } from './apiClient'

beforeEach(() => {
  setAddress('c-1', 'addressed-1')
})

describe('setModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with model in body', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await setModel('claude-opus-5')

    expect(containerFetch).toHaveBeenCalledWith(
      '/api/model?session_id=addressed-1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-5' }),
      },
      undefined,
    )
  })

  it('names the target session and container when given', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await setModel('claude-opus-5', { sessionId: 'S1', containerId: 'c1' })

    expect(containerFetch).toHaveBeenCalledWith(
      '/api/model?session_id=S1',
      expect.any(Object),
      'c1',
    )
  })

  it('throws on network error', async () => {
    containerFetch.mockRejectedValue(new Error('Network error'))

    await expect(setModel('claude-opus-5')).rejects.toThrow('Network error')
  })

  it('throws when the agent does not apply it', async () => {
    containerFetch.mockResolvedValue({ ok: false, status: 409 })

    await expect(setModel('claude-opus-5')).rejects.toThrow('Failed to apply model')
  })
})
