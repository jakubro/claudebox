/** Tests for api/permissionModes.js permission mode switching. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setPermissionMode } from './permissionModes'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
}))

import { containerFetch } from './apiClient'

describe('setPermissionMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with permission_mode in body', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await setPermissionMode('plan')

    expect(containerFetch).toHaveBeenCalledWith('/api/permission-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission_mode: 'plan' }),
    })
  })

  it('throws on network error', async () => {
    containerFetch.mockRejectedValue(new Error('Network error'))

    await expect(setPermissionMode('plan')).rejects.toThrow('Network error')
  })
})
