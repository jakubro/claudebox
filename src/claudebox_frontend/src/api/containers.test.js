/** Tests for api/containers.js container management functions. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteContainer } from './containers'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
  workspaceFetch: vi.fn(),
}))

import { workspaceFetch } from './apiClient'

describe('deleteContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends DELETE and returns response json', async () => {
    const data = { deleted: true }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await deleteContainer('c1')

    expect(workspaceFetch).toHaveBeenCalledWith('/containers/c1', { method: 'DELETE' })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(deleteContainer('c1')).rejects.toThrow('Failed to delete container')
  })
})
