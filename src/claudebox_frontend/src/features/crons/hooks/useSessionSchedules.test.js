/** Tests for useSessionSchedules. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../../utils/deferred'
import useSessionSchedules from './useSessionSchedules'

const mockList = vi.fn()
const mockReport = vi.fn()
let mockWorkspaceId = 'ws-1'
let mockChanges = {}

vi.mock('../../../api/sessions', () => ({ listSessionSchedules: (...a) => mockList(...a) }))
vi.mock('../../../api/errorReport', () => ({ reportError: (...a) => mockReport(...a) }))
vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: mockWorkspaceId }),
}))
vi.mock('../../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => ({ changesByWorkspace: mockChanges }),
}))

const answer = (sid, since = null) => ({
  sessions: [{ session_id: sid, responding_since: since, events: [{ type: 'x' }] }],
})

describe('useSessionSchedules', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockReport.mockReset()
    mockWorkspaceId = 'ws-1'
    mockChanges = {}
  })

  it('fetches on mount and maps each session to a source', async () => {
    mockList.mockResolvedValue(answer('s1', '2026-10-20T10:00:00Z'))

    const { result } = renderHook(() => useSessionSchedules())

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.sources).toEqual([
      { sessionId: 's1', events: [{ type: 'x' }], respondingSince: Date.UTC(2026, 9, 20, 10) },
    ])
    expect(mockList).toHaveBeenCalledTimes(1)
  })

  it("refetches on its own workspace's change count only", async () => {
    mockList.mockResolvedValue(answer('s1'))
    const { result, rerender } = renderHook(() => useSessionSchedules())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    mockChanges = { 'ws-other': 3 }
    rerender()
    mockChanges = { 'ws-other': 3, 'ws-1': 1 }
    rerender()

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
  })

  it('re-arms exactly one refetch for signals landing mid-flight', async () => {
    const first = createDeferred()
    mockList.mockReturnValueOnce(first.promise).mockResolvedValue(answer('s2'))
    const { result, rerender } = renderHook(() => useSessionSchedules())

    for (const count of [1, 2, 3]) {
      mockChanges = { 'ws-1': count }
      rerender()
    }
    await act(async () => first.resolve(answer('s1')))

    await waitFor(() => expect(result.current.sources[0]?.sessionId).toBe('s2'))
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it("drops a superseded workspace's answer", async () => {
    const stale = createDeferred()
    mockList.mockReturnValueOnce(stale.promise).mockResolvedValue(answer('fresh'))
    const { result, rerender } = renderHook(() => useSessionSchedules())

    mockWorkspaceId = 'ws-2'
    rerender()
    await waitFor(() => expect(result.current.sources[0]?.sessionId).toBe('fresh'))
    await act(async () => stale.resolve(answer('stale')))

    expect(result.current.sources[0].sessionId).toBe('fresh')
  })

  it('keeps the sources shown when a later fetch fails, and fails only with nothing shown', async () => {
    mockList.mockResolvedValueOnce(answer('s1')).mockRejectedValue(new Error('down'))
    const { result, rerender } = renderHook(() => useSessionSchedules())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    mockChanges = { 'ws-1': 1 }
    rerender()
    await waitFor(() => expect(mockReport).toHaveBeenCalled())

    expect(result.current.sources[0].sessionId).toBe('s1')
    expect(result.current.failed).toBe(false)

    mockWorkspaceId = 'ws-2'
    rerender()
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.sources).toEqual([])
  })
})
