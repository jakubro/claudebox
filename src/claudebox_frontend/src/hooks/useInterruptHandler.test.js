/** Tests for useInterruptHandler - start/await/complete around the interrupt call. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useInterruptHandler from './useInterruptHandler'

vi.mock('../api/chat', () => ({
  interrupt: vi.fn(),
}))

import { interrupt } from '../api/chat'

describe('useInterruptHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to the main interrupt() call when interruptFn is not given', async () => {
    interrupt.mockResolvedValue(undefined)
    const startInterrupt = vi.fn()
    const completeInterrupt = vi.fn()
    const { result } = renderHook(() =>
      useInterruptHandler({ startInterrupt, completeInterrupt, setError: vi.fn() }),
    )

    await result.current()

    expect(interrupt).toHaveBeenCalledOnce()
    expect(startInterrupt).toHaveBeenCalledOnce()
    expect(completeInterrupt).toHaveBeenCalledOnce()
  })

  it('calls the given interruptFn instead of the main interrupt() when provided', async () => {
    const interruptFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useInterruptHandler({
        startInterrupt: vi.fn(),
        completeInterrupt: vi.fn(),
        setError: vi.fn(),
        interruptFn,
      }),
    )

    await result.current()

    expect(interruptFn).toHaveBeenCalledOnce()
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('is a no-op when disabled', async () => {
    const interruptFn = vi.fn()
    const startInterrupt = vi.fn()
    const { result } = renderHook(() =>
      useInterruptHandler({
        startInterrupt,
        completeInterrupt: vi.fn(),
        setError: vi.fn(),
        disabled: true,
        interruptFn,
      }),
    )

    await result.current()

    expect(startInterrupt).not.toHaveBeenCalled()
    expect(interruptFn).not.toHaveBeenCalled()
  })

  it('sets an error and never completes when interruptFn rejects', async () => {
    const interruptFn = vi.fn().mockRejectedValue(new Error('boom'))
    const completeInterrupt = vi.fn()
    const setError = vi.fn()
    const { result } = renderHook(() =>
      useInterruptHandler({
        startInterrupt: vi.fn(),
        completeInterrupt,
        setError,
        interruptFn,
      }),
    )

    await result.current()

    expect(setError).toHaveBeenCalledWith('Interrupt failed')
    expect(completeInterrupt).not.toHaveBeenCalled()
  })
})
