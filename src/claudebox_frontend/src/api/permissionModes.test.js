/** Tests for api/permissionModes.js permission mode switching. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setPermissionMode } from './permissionModes'

vi.mock('./apiClient', async importOriginal => ({
  ...(await importOriginal()),
  containerFetch: vi.fn(),
}))

import { containerFetch, setAddress } from './apiClient'

beforeEach(() => {
  setAddress('c-1', 'addressed-1')
})

describe('setPermissionMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with permission_mode in body', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await setPermissionMode('plan')

    expect(containerFetch).toHaveBeenCalledWith(
      '/api/permission-mode?session_id=addressed-1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_mode: 'plan' }),
      },
      undefined,
    )
  })

  it('names the target session and container when given', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await setPermissionMode('plan', { sessionId: 'S1', containerId: 'c1' })

    expect(containerFetch).toHaveBeenCalledWith(
      '/api/permission-mode?session_id=S1',
      expect.any(Object),
      'c1',
    )
  })

  it('throws on network error', async () => {
    containerFetch.mockRejectedValue(new Error('Network error'))

    await expect(setPermissionMode('plan')).rejects.toThrow('Network error')
  })

  it('throws when the agent does not apply it', async () => {
    containerFetch.mockResolvedValue({ ok: false, status: 409 })

    await expect(setPermissionMode('plan')).rejects.toThrow('Failed to apply permission mode')
  })
})
