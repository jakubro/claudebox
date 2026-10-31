/** Tests for useChatCreatingClear - "Creating" ends only after its request has settled. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREATING_OVERLAY_TIMEOUT_MS } from '../../../config/timing'
import useChatCreatingClear from './useChatCreatingClear'

function renderClear() {
  const clearCreating = vi.fn()
  let props = {
    isCreating: true,
    isCreateRequestPending: true,
    isConnected: true,
    deferredSend: null,
    showPendingMessagesLength: 0,
    turnsLength: 0,
    clearCreating,
  }
  const { rerender } = renderHook(current => useChatCreatingClear(current), { initialProps: props })
  const update = patch => {
    props = { ...props, ...patch }
    rerender(props)
  }

  return { clearCreating, update }
}

describe('useChatCreatingClear', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not time out while the create request is pending', () => {
    const { clearCreating } = renderClear()

    vi.advanceTimersByTime(CREATING_OVERLAY_TIMEOUT_MS + 1000)

    expect(clearCreating).not.toHaveBeenCalled()
  })

  it('ignores the stream being left dropping and reconnecting mid-create', () => {
    const { clearCreating, update } = renderClear()

    update({ isConnected: false })
    update({ isConnected: true })

    expect(clearCreating).not.toHaveBeenCalled()
  })

  it("clears once the new session's stream connects after the request settled", () => {
    const { clearCreating, update } = renderClear()

    update({ isCreateRequestPending: false, isConnected: false })
    update({ isConnected: true })

    expect(clearCreating).toHaveBeenCalledTimes(1)
  })

  it('times out only after the request has settled', () => {
    const { clearCreating, update } = renderClear()
    vi.advanceTimersByTime(CREATING_OVERLAY_TIMEOUT_MS)

    update({ isCreateRequestPending: false, isConnected: false })
    vi.advanceTimersByTime(CREATING_OVERLAY_TIMEOUT_MS - 1)
    expect(clearCreating).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(clearCreating).toHaveBeenCalledTimes(1)
  })
})
