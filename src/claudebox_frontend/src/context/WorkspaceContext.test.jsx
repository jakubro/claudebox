/** Tests for WorkspaceContext. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace, WorkspaceProvider } from './WorkspaceContext'

const mockSetWorkspaceId = vi.fn()
const mockLocalStorage = {}

vi.mock('../api/apiClient', () => ({
  setWorkspaceId: (...args) => mockSetWorkspaceId(...args),
}))

vi.mock('../config/storage', () => ({
  WORKSPACE_STORAGE_KEY: 'claudebox-workspace-id',
}))

describe('useWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(key => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key, val) => {
        mockLocalStorage[key] = val
      }),
      removeItem: vi.fn(key => {
        delete mockLocalStorage[key]
      }),
    })
    // Clear stored values
    for (const key of Object.keys(mockLocalStorage)) {
      delete mockLocalStorage[key]
    }
  })

  const wrapper = ({ children }) => <WorkspaceProvider>{children}</WorkspaceProvider>

  it('throws when used outside WorkspaceProvider', () => {
    expect(() => renderHook(() => useWorkspace())).toThrow(
      'useWorkspace must be used within WorkspaceProvider',
    )
  })

  it('auto-selects single workspace', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workspaces: [{ id: 'ws-1', name: 'My Workspace' }] }),
    })

    const { result } = renderHook(() => useWorkspace(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.workspaceId).toBe('ws-1')
    expect(result.current.workspaces).toEqual([{ id: 'ws-1', name: 'My Workspace' }])
    expect(mockSetWorkspaceId).toHaveBeenCalledWith('ws-1')
  })

  it('restores workspace from localStorage when multiple exist', async () => {
    mockLocalStorage['claudebox-workspace-id'] = 'ws-2'

    fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          workspaces: [
            { id: 'ws-1', name: 'First' },
            { id: 'ws-2', name: 'Second' },
          ],
        }),
    })

    const { result } = renderHook(() => useWorkspace(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.workspaceId).toBe('ws-2')
    expect(mockSetWorkspaceId).toHaveBeenCalledWith('ws-2')
  })

  it('falls back to first workspace when stored ID not found', async () => {
    mockLocalStorage['claudebox-workspace-id'] = 'ws-gone'

    fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          workspaces: [
            { id: 'ws-1', name: 'First' },
            { id: 'ws-2', name: 'Second' },
          ],
        }),
    })

    const { result } = renderHook(() => useWorkspace(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.workspaceId).toBe('ws-1')
  })

  it('handles daemon not available gracefully', async () => {
    fetch.mockRejectedValue(new Error('Connection refused'))

    const { result } = renderHook(() => useWorkspace(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.workspaceId).toBeNull()
    expect(result.current.workspaces).toEqual([])
  })

  it('handles failed response gracefully', async () => {
    fetch.mockResolvedValue({ ok: false })

    const { result } = renderHook(() => useWorkspace(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.workspaceId).toBeNull()
  })

  it('selectWorkspace updates state and persists', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          workspaces: [
            { id: 'ws-1', name: 'First' },
            { id: 'ws-2', name: 'Second' },
          ],
        }),
    })

    const { result } = renderHook(() => useWorkspace(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.selectWorkspace('ws-2')
    })

    expect(result.current.workspaceId).toBe('ws-2')
    expect(mockSetWorkspaceId).toHaveBeenCalledWith('ws-2')
    expect(localStorage.setItem).toHaveBeenCalledWith('claudebox-workspace-id', 'ws-2')
  })

  it('handles empty workspaces list', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workspaces: [] }),
    })

    const { result } = renderHook(() => useWorkspace(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.workspaceId).toBeNull()
    expect(result.current.workspaces).toEqual([])
  })
})
