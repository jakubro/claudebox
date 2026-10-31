/** Tests for useSwitchToSession. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useSwitchToSession from './useSwitchToSession'

const mockNavigate = vi.fn()
const mockToast = vi.fn()
let mockResponding = false

vi.mock('../context/SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: 's1', sessionName: 'parser work' }),
}))
vi.mock('../context/EventsContext', () => ({
  useEvents: () => ({ isResponding: mockResponding }),
}))
vi.mock('../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ navigateToSession: mockNavigate }),
}))
vi.mock('../context/StillRunningToastContext', () => ({
  useStillRunningToast: () => ({ showStillRunningToast: mockToast }),
}))
vi.mock('../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'ws-1' }),
}))

describe('useSwitchToSession', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockToast.mockClear()
    mockResponding = false
  })

  it('opens the other session at the jump target', () => {
    const { result } = renderHook(() => useSwitchToSession())

    result.current('s2', { turnId: 't9' })

    expect(mockNavigate).toHaveBeenCalledWith('ws-1', 's2', { turnId: 't9' })
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('shows the still-running toast for a session left mid-answer, returning to it', () => {
    mockResponding = true
    const { result } = renderHook(() => useSwitchToSession())

    result.current('s2', { turnId: 't9' })

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ sessionName: 'parser work' }))
    mockToast.mock.calls[0][0].onReturn()
    expect(mockNavigate).toHaveBeenLastCalledWith('ws-1', 's1')
  })
})
