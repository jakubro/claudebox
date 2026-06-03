/** Tests for api/models.js model switching. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setModel } from './models'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
}))

import { containerFetch } from './apiClient'

describe('setModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with model in body', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await setModel('claude-opus-4-6')

    expect(containerFetch).toHaveBeenCalledWith('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-6' }),
    })
  })

  it('throws on network error', async () => {
    containerFetch.mockRejectedValue(new Error('Network error'))

    await expect(setModel('claude-opus-4-6')).rejects.toThrow('Network error')
  })
})
