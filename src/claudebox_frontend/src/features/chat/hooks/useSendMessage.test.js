/** Tests for useSendMessage hook. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSendMessage = vi.fn()

vi.mock('../../../api/chat', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    sendMessage: (...args) => mockSendMessage(...args),
  }
})

import { ContainerGoneError } from '../../../api/chat'
import useSendMessage from './useSendMessage'

describe('useSendMessage', () => {
  let deps

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage.mockResolvedValue(undefined)
    deps = {
      addPendingMessage: vi.fn().mockReturnValue('msg-1'),
      removePendingMessage: vi.fn(),
      startSubmitting: vi.fn(),
      submitSucceeded: vi.fn(),
      submitFailed: vi.fn(),
      setError: vi.fn(),
    }
  })

  it('calls state transitions in order on success', async () => {
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('hello')
    })

    expect(deps.addPendingMessage).toHaveBeenCalledWith('hello', null)
    expect(deps.startSubmitting).toHaveBeenCalledOnce()
    expect(mockSendMessage).toHaveBeenCalledWith('hello', null)
    expect(deps.submitSucceeded).toHaveBeenCalledOnce()
    expect(deps.submitFailed).not.toHaveBeenCalled()
  })

  it('passes attachments through', async () => {
    const attachments = [{ name: 'f.txt' }]
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('msg', attachments)
    })

    expect(deps.addPendingMessage).toHaveBeenCalledWith('msg', attachments)
    expect(mockSendMessage).toHaveBeenCalledWith('msg', attachments)
  })

  it('removes pending message and calls submitFailed on error', async () => {
    mockSendMessage.mockRejectedValue(new Error('Network'))
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('fail')
    })

    expect(deps.removePendingMessage).toHaveBeenCalledWith('msg-1')
    expect(deps.submitFailed).toHaveBeenCalledOnce()
    expect(deps.setError).toHaveBeenCalledWith('Send failed')
    expect(deps.submitSucceeded).not.toHaveBeenCalled()
  })

  it('skips removePendingMessage when addPendingMessage returns falsy', async () => {
    deps.addPendingMessage.mockReturnValue(null)
    mockSendMessage.mockRejectedValue(new Error('err'))
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('x')
    })

    expect(deps.removePendingMessage).not.toHaveBeenCalled()
    expect(deps.submitFailed).toHaveBeenCalledOnce()
  })

  it('calls onContainerGone on ContainerGoneError', async () => {
    mockSendMessage.mockRejectedValue(new ContainerGoneError())
    deps.onContainerGone = vi.fn()
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('hello')
    })

    expect(deps.onContainerGone).toHaveBeenCalledOnce()
    expect(deps.setError).toHaveBeenCalledWith(
      'Connection lost - retrying. Your message is preserved.',
    )
    expect(deps.submitFailed).toHaveBeenCalledOnce()
  })

  it('shows generic error for non-container errors', async () => {
    mockSendMessage.mockRejectedValue(new Error('Network'))
    deps.onContainerGone = vi.fn()
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('hello')
    })

    expect(deps.onContainerGone).not.toHaveBeenCalled()
    expect(deps.setError).toHaveBeenCalledWith('Send failed')
  })

  it('handles null addPendingMessage gracefully', async () => {
    deps.addPendingMessage = null
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('hello')
    })

    expect(deps.submitSucceeded).toHaveBeenCalledOnce()
  })
})
