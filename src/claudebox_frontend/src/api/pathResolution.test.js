/** Tests for api/pathResolution.js path resolution function. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePaths } from './pathResolution'

vi.mock('./apiClient', async importOriginal => ({
  ...(await importOriginal()),
  containerFetch: vi.fn(),
}))

import { containerFetch, setAddress } from './apiClient'

beforeEach(() => {
  setAddress('c-1', 'addressed-1')
})

describe('resolvePaths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST request with candidates', async () => {
    const resolved = { 'src/app.js': '/abs/src/app.js' }
    containerFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ resolved }),
    })

    const result = await resolvePaths(['src/app.js', 'missing.py'])

    expect(containerFetch).toHaveBeenCalledWith('/api/files/resolve-paths?session_id=addressed-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: ['src/app.js', 'missing.py'] }),
    })
    expect(result).toEqual(resolved)
  })

  it('throws when the response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(resolvePaths(['a.py'])).rejects.toThrow('Failed to resolve paths')
  })

  it('returns empty object when no candidates resolve', async () => {
    containerFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ resolved: {} }),
    })

    const result = await resolvePaths(['nonexistent.py'])
    expect(result).toEqual({})
  })
})
