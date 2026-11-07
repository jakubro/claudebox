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
import { clearPreservedInput, readPreservedInput } from '../utils/preservedInput'
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
      ownerNow: () => ({ sessionId: 'sess-a' }),
    }
  })

  function renderFailingSend(error) {
    mockSendMessage.mockRejectedValue(error)
    deps.onContainerGone = vi.fn()

    return renderHook(() => useSendMessage(deps)).result
  }

  it('calls state transitions in order on success', async () => {
    const { result } = renderHook(() => useSendMessage(deps))

    let outcome
    await act(async () => {
      outcome = await result.current('hello')
    })

    expect(outcome).toBe(true)
    expect(deps.addPendingMessage).toHaveBeenCalledWith(
      'hello',
      null,
      null,
      null,
      expect.any(Number),
    )
    expect(deps.startSubmitting).toHaveBeenCalledOnce()
    expect(mockSendMessage).toHaveBeenCalledWith('hello', {
      attachments: null,
      inlineReplies: null,
      note: null,
    })
    expect(deps.submitSucceeded).toHaveBeenCalledOnce()
    expect(deps.submitFailed).not.toHaveBeenCalled()
  })

  it('passes attachments through', async () => {
    const attachments = [{ name: 'f.txt' }]
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('msg', { attachments })
    })

    expect(deps.addPendingMessage).toHaveBeenCalledWith(
      'msg',
      attachments,
      null,
      null,
      expect.any(Number),
    )
    expect(mockSendMessage).toHaveBeenCalledWith('msg', {
      attachments,
      inlineReplies: null,
      note: null,
    })
  })

  it('gives the pending entry the time the message was first sent', async () => {
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('first', { sentAt: 1000 })
    })

    expect(deps.addPendingMessage).toHaveBeenCalledWith('first', null, null, null, 1000)
  })

  it('removes pending message and calls submitFailed on error', async () => {
    mockSendMessage.mockRejectedValue(new Error('Network'))
    const { result } = renderHook(() => useSendMessage(deps))

    let outcome
    await act(async () => {
      outcome = await result.current('fail')
    })

    expect(outcome).toBe(false)
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
    const result = renderFailingSend(new ContainerGoneError())

    let outcome
    await act(async () => {
      outcome = await result.current('hello')
    })

    expect(outcome).toBe(false)
    expect(deps.onContainerGone).toHaveBeenCalledOnce()
    expect(deps.setError).toHaveBeenCalledWith(
      'Connection lost - retrying. Your message is preserved.',
    )
    expect(deps.submitFailed).toHaveBeenCalledOnce()
    expect(JSON.parse(sessionStorage.getItem('_cb_preserved_input'))).toEqual({
      owner: { sessionId: 'sess-a' },
      content: 'hello',
    })
  })

  it('keeps the text typed beside a reply, not the reply itself, when the container is gone', async () => {
    mockSendMessage.mockRejectedValue(new ContainerGoneError())
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('Go', { note: 'but skip the docs' })
    })

    expect(JSON.parse(sessionStorage.getItem('_cb_preserved_input'))).toEqual({
      owner: { sessionId: 'sess-a' },
      content: 'but skip the docs',
    })
  })

  it('text from a send that fails after a move is kept for the session it was typed in', async () => {
    clearPreservedInput()
    const owners = [{ sessionId: 'S1' }, { sessionId: 'S2' }]
    deps.ownerNow = () => owners[0]
    mockSendMessage.mockImplementation(async () => {
      owners.shift()
      throw new ContainerGoneError()
    })
    const { result } = renderHook(() => useSendMessage(deps))

    await act(async () => {
      await result.current('typed in S1')
    })

    expect(readPreservedInput().owner).toEqual({ sessionId: 'S1' })
    expect(deps.setError).not.toHaveBeenCalled()
  })

  it('shows generic error for non-container errors', async () => {
    const result = renderFailingSend(new Error('Network'))

    await act(async () => {
      await result.current('hello')
    })

    expect(deps.onContainerGone).not.toHaveBeenCalled()
    expect(deps.setError).toHaveBeenCalledWith('Send failed')
  })

  it('resolves false, not container-gone, on a request timeout', async () => {
    const timeoutError = new Error('The operation timed out')
    timeoutError.name = 'TimeoutError'
    const result = renderFailingSend(timeoutError)

    let outcome
    await act(async () => {
      outcome = await result.current('hello')
    })

    expect(outcome).toBe(false)
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
