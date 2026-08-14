/** Tests for useSessionDefaults hook. */

import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_DEFAULTS_CACHE_TTL_MS } from '../config/timing'
import { WorkspaceContext } from '../context/WorkspaceContext'
import useSessionDefaults from './useSessionDefaults'

const mockGetSessionDefaults = vi.fn()

vi.mock('../api/workspaces', () => ({
  getSessionDefaults: (...args) => mockGetSessionDefaults(...args),
}))

const DEFAULTS_A = {
  workspace: 'ws-a',
  model: 'opus',
  permission_mode: 'default',
  effort_level: 'high',
}
const DEFAULTS_B = {
  workspace: 'ws-b',
  model: 'sonnet',
  permission_mode: 'plan',
  effort_level: 'low',
}

/** Wrap the hook in a WorkspaceContext provider fixed to the given workspace id. */
const workspaceWrapper = workspaceId =>
  function Wrapper({ children }) {
    return createElement(WorkspaceContext.Provider, { value: { workspaceId } }, children)
  }

const renderWithWorkspace = workspaceId =>
  renderHook(() => useSessionDefaults(), { wrapper: workspaceWrapper(workspaceId) })

// renderHook wrappers get no rerender props - mutate this var and call rerender() to change it.
let _reactiveWorkspaceId = null
function ReactiveWorkspaceWrapper({ children }) {
  return createElement(
    WorkspaceContext.Provider,
    { value: { workspaceId: _reactiveWorkspaceId } },
    children,
  )
}

describe('useSessionDefaults', () => {
  beforeEach(() => {
    mockGetSessionDefaults.mockReset()
    useSessionDefaults.resetCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null and issues no request outside a WorkspaceProvider', () => {
    const { result } = renderHook(() => useSessionDefaults())

    expect(result.current).toBeNull()
    expect(mockGetSessionDefaults).not.toHaveBeenCalled()
  })

  it('fetches and returns the response verbatim', async () => {
    mockGetSessionDefaults.mockResolvedValue(DEFAULTS_A)

    const { result } = renderWithWorkspace('ws-a')

    await waitFor(() => {
      expect(result.current).toEqual(DEFAULTS_A)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(1)
  })

  it('refetches when the workspace id changes on the same instance', async () => {
    mockGetSessionDefaults.mockResolvedValueOnce(DEFAULTS_A).mockResolvedValueOnce(DEFAULTS_B)
    _reactiveWorkspaceId = 'ws-a'

    const { result, rerender } = renderHook(() => useSessionDefaults(), {
      wrapper: ReactiveWorkspaceWrapper,
    })

    await waitFor(() => {
      expect(result.current).toEqual(DEFAULTS_A)
    })

    _reactiveWorkspaceId = 'ws-b'
    rerender()

    await waitFor(() => {
      expect(result.current).toEqual(DEFAULTS_B)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(2)
  })

  it('two concurrent hook instances for the same workspace produce one fetch and both resolve', async () => {
    mockGetSessionDefaults.mockResolvedValue(DEFAULTS_A)

    const first = renderWithWorkspace('ws-a')
    const second = renderWithWorkspace('ws-a')

    await waitFor(() => {
      expect(first.result.current).toEqual(DEFAULTS_A)
      expect(second.result.current).toEqual(DEFAULTS_A)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(1)
  })

  it('a mount after the value is cached and fresh produces no fetch', async () => {
    mockGetSessionDefaults.mockResolvedValue(DEFAULTS_A)

    const first = renderWithWorkspace('ws-a')
    await waitFor(() => {
      expect(first.result.current).toEqual(DEFAULTS_A)
    })

    const second = renderWithWorkspace('ws-a')
    await waitFor(() => {
      expect(second.result.current).toEqual(DEFAULTS_A)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(1)
  })

  it('a mount after the TTL has elapsed refetches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetSessionDefaults.mockResolvedValue(DEFAULTS_A)

    const first = renderWithWorkspace('ws-a')
    await vi.waitFor(() => {
      expect(first.result.current).toEqual(DEFAULTS_A)
    })

    vi.advanceTimersByTime(SESSION_DEFAULTS_CACHE_TTL_MS + 1)

    const second = renderWithWorkspace('ws-a')
    await vi.waitFor(() => {
      expect(second.result.current).toEqual(DEFAULTS_A)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(2)
  })

  it('a different workspace id fetches separately and does not evict the first', async () => {
    mockGetSessionDefaults.mockResolvedValueOnce(DEFAULTS_A).mockResolvedValueOnce(DEFAULTS_B)

    const a = renderWithWorkspace('ws-a')
    await waitFor(() => {
      expect(a.result.current).toEqual(DEFAULTS_A)
    })

    const b = renderWithWorkspace('ws-b')
    await waitFor(() => {
      expect(b.result.current).toEqual(DEFAULTS_B)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(2)

    // First workspace's cached value is still there, untouched by the second fetch.
    const aAgain = renderWithWorkspace('ws-a')
    await waitFor(() => {
      expect(aAgain.result.current).toEqual(DEFAULTS_A)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(2)
  })

  it('does not cache a rejected request - the next mount retries', async () => {
    mockGetSessionDefaults.mockRejectedValueOnce(new Error('network error'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const first = renderWithWorkspace('ws-a')
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled()
    })
    expect(first.result.current).toBeNull()

    mockGetSessionDefaults.mockResolvedValueOnce(DEFAULTS_A)
    const second = renderWithWorkspace('ws-a')
    await waitFor(() => {
      expect(second.result.current).toEqual(DEFAULTS_A)
    })
    expect(mockGetSessionDefaults).toHaveBeenCalledTimes(2)

    warnSpy.mockRestore()
  })
})
