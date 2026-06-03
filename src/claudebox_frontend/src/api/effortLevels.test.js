/** Tests for api/effortLevels.js effort level switching. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setEffortLevel } from './effortLevels'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
  workspaceFetch: vi.fn(),
}))

import { containerFetch } from './apiClient'

describe('setEffortLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with effort level and returns void', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    const result = await setEffortLevel('high')

    expect(containerFetch).toHaveBeenCalledWith('/api/effort-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effort_level: 'high' }),
    })
    expect(result).toBeUndefined()
  })
})
