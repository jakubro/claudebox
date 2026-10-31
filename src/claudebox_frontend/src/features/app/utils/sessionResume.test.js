/** Tests for resumeAndReconnect's ownership guard. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockResumeSession = vi.fn()
const mockSetAddress = vi.fn()

vi.mock('../../../api/sessions', () => ({
  resumeSession: (...args) => mockResumeSession(...args),
}))
vi.mock('../../../api/apiClient', () => ({
  setAddress: (...args) => mockSetAddress(...args),
}))

import { resumeAndReconnect } from './sessionResume'

describe('resumeAndReconnect', () => {
  let deps

  beforeEach(() => {
    vi.clearAllMocks()
    deps = {
      activeSessionId: 'session-a',
      isStillActive: () => true,
      startResume: vi.fn(() => 5),
      settleResumeRequest: vi.fn(),
      reconnectSSE: vi.fn(),
      notifyAddressChanged: vi.fn(),
      setSessionContainer: vi.fn(),
      clearSessionData: vi.fn(),
      onError: vi.fn(),
    }
  })

  it('resumes, records the mapping and reconnects when the caller is still active', async () => {
    mockResumeSession.mockResolvedValueOnce({ container_id: 'c1' })

    await resumeAndReconnect(deps)

    expect(mockSetAddress).toHaveBeenCalledWith('c1', 'session-a')
    expect(deps.notifyAddressChanged).toHaveBeenCalledOnce()
    expect(deps.setSessionContainer).toHaveBeenCalledWith('session-a', 'c1')
    expect(deps.clearSessionData).toHaveBeenCalledOnce()
    expect(deps.reconnectSSE).toHaveBeenCalledOnce()
  })

  it('settles its open request, by its token, before reconnecting', async () => {
    mockResumeSession.mockResolvedValueOnce({ container_id: 'c1' })
    const order = []
    deps.settleResumeRequest = vi.fn(token => order.push(`settle:${token}`))
    deps.reconnectSSE = vi.fn(() => order.push('reconnect'))

    await resumeAndReconnect(deps)

    expect(order).toEqual(['settle:5', 'reconnect'])
  })

  it('writes nothing and does not reconnect when the reader switched sessions before it resolved', async () => {
    mockResumeSession.mockResolvedValueOnce({ container_id: 'c1' })
    deps.isStillActive = () => false

    await resumeAndReconnect(deps)

    expect(mockSetAddress).not.toHaveBeenCalled()
    expect(deps.notifyAddressChanged).not.toHaveBeenCalled()
    expect(deps.setSessionContainer).not.toHaveBeenCalled()
    expect(deps.clearSessionData).not.toHaveBeenCalled()
    expect(deps.reconnectSSE).not.toHaveBeenCalled()
  })

  it('does not raise the error over a session the reader has since left', async () => {
    mockResumeSession.mockRejectedValueOnce(new Error('gone'))
    deps.isStillActive = () => false

    await resumeAndReconnect(deps)

    expect(deps.onError).not.toHaveBeenCalled()
  })

  it('still raises the error for a failure on the session that is still open', async () => {
    mockResumeSession.mockRejectedValueOnce(new Error('gone'))

    await resumeAndReconnect(deps)

    expect(deps.onError).toHaveBeenCalledOnce()
  })
})
