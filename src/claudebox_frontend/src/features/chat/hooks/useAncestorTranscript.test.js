/** Tests for useAncestorTranscript - fetch + derive an ancestor's read-only transcript. */

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionEvents } from '../../../api/sessions'
import useAncestorTranscript from './useAncestorTranscript'

vi.mock('../../../api/sessions', () => ({
  getSessionEvents: vi.fn(),
}))

beforeEach(() => {
  getSessionEvents.mockReset()
})

function humanEvent(id, turnId, content) {
  return { id, type: 'user', subtype: 'text', is_human: true, turn_id: turnId, content }
}

function assistantEvent(id, content) {
  return { id, type: 'assistant', subtype: 'text', is_human: false, content }
}

describe('useAncestorTranscript', () => {
  it('starts in loading status', () => {
    getSessionEvents.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useAncestorTranscript('sess-1'))

    expect(result.current.status).toBe('loading')
    expect(result.current.turns).toEqual([])
  })

  it('derives turns from persisted events via the same pipeline the live path uses', async () => {
    getSessionEvents.mockResolvedValue({
      events: [humanEvent('e1', 't1', 'hi'), assistantEvent('e2', 'hello back')],
      running: false,
    })

    const { result } = renderHook(() => useAncestorTranscript('sess-1'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.turns).toHaveLength(1)
    expect(result.current.turns[0].userMessage).toBe('hi')
  })

  it('reports unavailable when the read-only route fails', async () => {
    getSessionEvents.mockRejectedValue(new Error('404'))

    const { result } = renderHook(() => useAncestorTranscript('deleted-sess'))

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.turns).toEqual([])
  })

  it('reports unavailable with no fetch at all when sessionId is absent', () => {
    const { result } = renderHook(() => useAncestorTranscript(null))

    expect(result.current.status).toBe('unavailable')
    expect(getSessionEvents).not.toHaveBeenCalled()
  })

  it('refetches when sessionId changes', async () => {
    getSessionEvents.mockResolvedValue({ events: [], running: false })
    const { result, rerender } = renderHook(({ id }) => useAncestorTranscript(id), {
      initialProps: { id: 'sess-1' },
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))

    rerender({ id: 'sess-2' })

    await waitFor(() => expect(getSessionEvents).toHaveBeenCalledWith('sess-2'))
  })
})
