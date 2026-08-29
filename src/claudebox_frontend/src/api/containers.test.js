/** Tests for api/containers.js container management functions. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FETCH_TIMEOUT_CONTAINER_LIFECYCLE_MS,
  FETCH_TIMEOUT_INTERACTIVE_MS,
} from '../config/timing'
import { deleteContainer, getContainer } from './containers'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
  workspaceFetch: vi.fn(),
}))

import { workspaceFetch } from './apiClient'

describe('getContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the registry entry on the interactive tier, threading the caller signal', async () => {
    const data = { backend_id: 'backend-abc' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })
    const controller = new AbortController()

    const result = await getContainer('c1', { signal: controller.signal })

    expect(workspaceFetch).toHaveBeenCalledWith('/containers/c1', {
      signal: controller.signal,
      timeoutMs: FETCH_TIMEOUT_INTERACTIVE_MS,
    })
    expect(result).toEqual(data)
  })

  it('returns null without reading the body when the response is not ok', async () => {
    const json = vi.fn()
    workspaceFetch.mockResolvedValue({ ok: false, json })

    expect(await getContainer('c1')).toBeNull()
    expect(json).not.toHaveBeenCalled()
  })
})

describe('deleteContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends DELETE and returns response json', async () => {
    const data = { deleted: true }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await deleteContainer('c1')

    expect(workspaceFetch).toHaveBeenCalledWith('/containers/c1', {
      method: 'DELETE',
      timeoutMs: FETCH_TIMEOUT_CONTAINER_LIFECYCLE_MS,
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(deleteContainer('c1')).rejects.toThrow('Failed to delete container')
  })
})
