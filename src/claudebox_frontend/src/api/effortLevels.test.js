/** Tests for api/effortLevels.js effort level switching. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setEffortLevel } from './effortLevels'

vi.mock('./apiClient', async importOriginal => ({
  ...(await importOriginal()),
  containerFetch: vi.fn(),
  workspaceFetch: vi.fn(),
}))

import { containerFetch, setAddress } from './apiClient'

beforeEach(() => {
  setAddress('c-1', 'addressed-1')
})

describe('setEffortLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with effort level and returns void', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    const result = await setEffortLevel('high')

    expect(containerFetch).toHaveBeenCalledWith(
      '/api/effort-level?session_id=addressed-1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effort_level: 'high' }),
      },
      undefined,
    )
    expect(result).toBeUndefined()
  })

  it('names the target session and container when given', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await setEffortLevel('low', { sessionId: 'S1', containerId: 'c1' })

    expect(containerFetch).toHaveBeenCalledWith(
      '/api/effort-level?session_id=S1',
      expect.any(Object),
      'c1',
    )
  })

  it('throws when the agent does not apply it', async () => {
    containerFetch.mockResolvedValue({ ok: false, status: 409 })

    await expect(setEffortLevel('low')).rejects.toThrow('Failed to apply effort level')
  })
})
