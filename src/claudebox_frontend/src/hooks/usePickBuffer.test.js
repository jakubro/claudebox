/** Tests for usePickBuffer: a drain names the session it was for, whatever is on screen by its end. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { containerFetch, setAddress, setWorkspaceId } from '../api/apiClient'
import usePickBuffer from './usePickBuffer'

vi.mock('../api/apiClient', async importOriginal => ({
  ...(await importOriginal()),
  containerFetch: vi.fn(),
}))

const creations = { current: 0, bySeq: {} }

function props(overrides) {
  return {
    workspaceId: 'w1',
    routedSessionId: 'S1',
    attachedSessionId: null,
    containerId: null,
    isOwnerAttached: false,
    creations,
    getCreation: () => creations,
    refreshSession: vi.fn(() => Promise.resolve()),
    onError: vi.fn(),
    ...overrides,
  }
}

describe('usePickBuffer drain', () => {
  let releaseModel

  beforeEach(() => {
    setWorkspaceId('w1')
    setAddress('c1', 'S1')
    containerFetch.mockReset()
    containerFetch.mockImplementation(path =>
      path.startsWith('/api/model')
        ? new Promise(resolve => {
            releaseModel = () => resolve({ ok: true })
          })
        : Promise.resolve({ ok: true }),
    )
  })

  async function drainHeldOnTheModel() {
    const hook = renderHook(p => usePickBuffer(p), { initialProps: props() })
    act(() => {
      hook.result.current.bufferPick('model', 'm')
      hook.result.current.bufferPick('permissionMode', 'plan')
      hook.result.current.bufferPick('effortLevel', 'low')
    })
    hook.rerender(props({ attachedSessionId: 'S1', containerId: 'c1', isOwnerAttached: true }))
    await waitFor(() => expect(containerFetch).toHaveBeenCalledTimes(1))
    setAddress('c2', 'S2')
    hook.rerender(
      props({
        routedSessionId: 'S2',
        attachedSessionId: 'S2',
        containerId: 'c2',
        isOwnerAttached: true,
      }),
    )
    return hook
  }

  it('a switch mid-drain keeps the later picks on the session they were for', async () => {
    await drainHeldOnTheModel()

    await act(async () => releaseModel())

    await waitFor(() => expect(containerFetch).toHaveBeenCalledTimes(3))
    expect(containerFetch.mock.calls.map(([path, , container]) => `${container} ${path}`)).toEqual([
      'c1 /api/model?session_id=S1',
      'c1 /api/permission-mode?session_id=S1',
      'c1 /api/effort-level?session_id=S1',
    ])
  })

  it("another session's footer never shows picks still applying", async () => {
    const { result } = await drainHeldOnTheModel()

    expect(result.current.pendingPermissionMode).toBeNull()
    expect(result.current.isApplyingPendingConfig).toBe(false)
    await act(async () => releaseModel())
  })
})

describe('usePickBuffer refusals', () => {
  beforeEach(() => {
    setWorkspaceId('w1')
    setAddress('c1', 'S1')
    containerFetch.mockReset()
    containerFetch.mockImplementation(path =>
      Promise.resolve({ ok: !path.startsWith('/api/permission-mode'), status: 409 }),
    )
  })

  it('reports a refused pick in the footer text and still applies the next', async () => {
    const initial = props()
    const hook = renderHook(p => usePickBuffer(p), { initialProps: initial })
    act(() => {
      hook.result.current.bufferPick('permissionMode', 'bypassPermissions')
      hook.result.current.bufferPick('effortLevel', 'low')
    })

    hook.rerender({ ...initial, attachedSessionId: 'S1', containerId: 'c1', isOwnerAttached: true })

    await waitFor(() =>
      expect(initial.onError).toHaveBeenCalledWith('Failed to apply permission mode'),
    )
    await waitFor(() =>
      expect(containerFetch).toHaveBeenCalledWith(
        '/api/effort-level?session_id=S1',
        expect.any(Object),
        'c1',
      ),
    )
  })
})
