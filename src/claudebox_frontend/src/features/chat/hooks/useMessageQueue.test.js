/** Tests for useMessageQueue hook. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useMessageQueue from './useMessageQueue'

describe('useMessageQueue', () => {
  let sendFn

  beforeEach(() => {
    sendFn = vi.fn()
    localStorage.clear()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `test-uuid-${Math.random().toString(36).slice(2)}`),
    })
  })

  /** Helper: default props for renderHook. */
  function defaultProps(overrides = {}) {
    return {
      resultCount: 0,
      compactionCount: 0,
      interruptStatus: null,
      errorMessage: null,
      sessionId: 'session-1',
      sendFn,
      ...overrides,
    }
  }

  describe('enqueue and queue state', () => {
    it('starts with empty queue', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      expect(result.current.queueItems).toEqual([])
    })

    it('enqueueMessage adds item to queue', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      act(() => {
        result.current.enqueueMessage('hello')
      })

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('hello')
      expect(result.current.queueItems[0].status).toBe('queued')
    })

    it('enqueueMessage stores attachments', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      const attachments = [{ id: 'a1', name: 'file.txt' }]
      act(() => {
        result.current.enqueueMessage('with file', attachments)
      })

      expect(result.current.queueItems[0].attachments).toEqual(attachments)
    })

    it('enqueueMessage sets attachments to null for empty array', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      act(() => {
        result.current.enqueueMessage('no files', [])
      })

      expect(result.current.queueItems[0].attachments).toBeNull()
    })

    it('enqueues multiple items in order', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      act(() => {
        result.current.enqueueMessage('first')
        result.current.enqueueMessage('second')
        result.current.enqueueMessage('third')
      })

      expect(result.current.queueItems).toHaveLength(3)
      expect(result.current.queueItems[0].content).toBe('first')
      expect(result.current.queueItems[1].content).toBe('second')
      expect(result.current.queueItems[2].content).toBe('third')
    })
  })

  describe('drain on resultCount increment', () => {
    it('drains first queued item when resultCount increments', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('queued msg')
      })

      expect(result.current.queueItems).toHaveLength(1)

      // Increment resultCount to trigger drain
      rerender(defaultProps({ resultCount: 1 }))

      expect(sendFn).toHaveBeenCalledWith('queued msg', null)
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('drains with attachments when resultCount increments', () => {
      const attachments = [{ id: 'a1', name: 'img.png' }]
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('with attachment', attachments)
      })

      rerender(defaultProps({ resultCount: 1 }))

      expect(sendFn).toHaveBeenCalledWith('with attachment', attachments)
    })

    it('drains one item per resultCount increment', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('first')
        result.current.enqueueMessage('second')
      })

      expect(result.current.queueItems).toHaveLength(2)

      // First drain
      rerender(defaultProps({ resultCount: 1 }))

      expect(sendFn).toHaveBeenCalledTimes(1)
      expect(sendFn).toHaveBeenCalledWith('first', null)
      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('second')

      // Second drain
      rerender(defaultProps({ resultCount: 2 }))

      expect(sendFn).toHaveBeenCalledTimes(2)
      expect(sendFn).toHaveBeenLastCalledWith('second', null)
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('does not drain when resultCount stays the same', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('stay queued')
      })

      // Rerender with same resultCount
      rerender(defaultProps({ resultCount: 0 }))

      expect(sendFn).not.toHaveBeenCalled()
      expect(result.current.queueItems).toHaveLength(1)
    })

    it('does not call sendFn when queue is empty on drain', () => {
      const { rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      // Increment resultCount with no items queued
      rerender(defaultProps({ resultCount: 1 }))

      expect(sendFn).not.toHaveBeenCalled()
    })

    it('handles multiple resultCount increments at once', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('msg')
      })

      // Jump from 0 to 5 (still triggers since 5 > 0)
      rerender(defaultProps({ resultCount: 5 }))

      expect(sendFn).toHaveBeenCalledTimes(1)
      expect(sendFn).toHaveBeenCalledWith('msg', null)
    })
  })

  describe('drain on compactionCount increment', () => {
    it('drains queued item when compactionCount increments', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ compactionCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('queued during compaction')
      })

      expect(result.current.queueItems).toHaveLength(1)

      rerender(defaultProps({ compactionCount: 1 }))

      expect(sendFn).toHaveBeenCalledWith('queued during compaction', null)
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('does not drain when compactionCount stays the same', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ compactionCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('msg')
      })

      rerender(defaultProps({ compactionCount: 0 }))

      expect(sendFn).not.toHaveBeenCalled()
      expect(result.current.queueItems).toHaveLength(1)
    })

    it('does not call sendFn when queue is empty on compaction drain', () => {
      const { rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ compactionCount: 0 }),
      })

      rerender(defaultProps({ compactionCount: 1 }))

      expect(sendFn).not.toHaveBeenCalled()
    })
  })

  describe('interrupt handling', () => {
    it('pauses queued items on interrupt stopping', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('to pause')
      })

      rerender(defaultProps({ resultCount: 0, interruptStatus: 'stopping' }))

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].status).toBe('paused')
    })

    it('pauses queued items on interrupt stopped', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('to pause')
      })

      rerender(defaultProps({ resultCount: 0, interruptStatus: 'stopped' }))

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].status).toBe('paused')
    })

    it('does not pause on unrelated interrupt status', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('stay queued')
      })

      rerender(defaultProps({ resultCount: 0, interruptStatus: 'other' }))

      expect(result.current.queueItems[0].status).toBe('queued')
    })
  })

  describe('error handling', () => {
    it('pauses queued items on error', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('to pause')
      })

      rerender(defaultProps({ resultCount: 0, errorMessage: 'something broke' }))

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].status).toBe('paused')
    })

    it('does not pause when errorMessage is null', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('stay queued')
      })

      rerender(defaultProps({ resultCount: 0, errorMessage: null }))

      expect(result.current.queueItems[0].status).toBe('queued')
    })
  })

  describe('session change', () => {
    it('clears queue on session change when new session has no stored data', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0, sessionId: 'session-1' }),
      })

      act(() => {
        result.current.enqueueMessage('will be cleared')
      })

      expect(result.current.queueItems).toHaveLength(1)

      rerender(defaultProps({ resultCount: 0, sessionId: 'session-2' }))

      expect(result.current.queueItems).toHaveLength(0)
    })

    it('restores queue from localStorage on session change', () => {
      const storedItems = [
        { id: 's1', content: 'stored msg', attachments: null, status: 'queued', addedAt: 1 },
      ]
      localStorage.setItem('queue:session-2', JSON.stringify(storedItems))

      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0, sessionId: 'session-1' }),
      })

      rerender(defaultProps({ resultCount: 0, sessionId: 'session-2' }))

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('stored msg')
    })
  })

  describe('fresh session orphan preservation', () => {
    it('preserves in-memory items when sessionId transitions null to value', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ sessionId: null }),
      })

      // Enqueue while sessionId is null (orphan — can't persist)
      act(() => {
        result.current.enqueueMessage('orphan msg')
      })

      expect(result.current.queueItems).toHaveLength(1)

      // Session init: null → value
      rerender(defaultProps({ sessionId: 'new-session' }))

      // Orphan survives the transition
      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('orphan msg')
    })

    it('clears queue on explicit session switch (value → null → value)', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ sessionId: 'session-1' }),
      })

      act(() => {
        result.current.enqueueMessage('session-1 msg')
      })

      // Explicit switch: value → null (clearSessionData)
      rerender(defaultProps({ sessionId: null }))

      expect(result.current.queueItems).toHaveLength(0)

      // Then null → value (new session connects)
      rerender(defaultProps({ sessionId: 'session-2' }))

      // No items carried over — queue was cleared at value→null step
      expect(result.current.queueItems).toHaveLength(0)
    })
  })

  describe('localStorage persistence', () => {
    it('persists queue to localStorage on enqueue', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ sessionId: 'session-1' }),
      })

      act(() => {
        result.current.enqueueMessage('persist me')
      })

      const stored = JSON.parse(localStorage.getItem('queue:session-1'))
      expect(stored).toHaveLength(1)
      expect(stored[0].content).toBe('persist me')
    })

    it('removes localStorage key when queue is emptied', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ sessionId: 'session-1' }),
      })

      act(() => {
        result.current.enqueueMessage('temp')
      })

      expect(localStorage.getItem('queue:session-1')).not.toBeNull()

      const id = result.current.queueItems[0].id
      act(() => {
        result.current.cancelQueuedItem(id)
      })

      expect(localStorage.getItem('queue:session-1')).toBeNull()
    })

    it('ignores corrupt localStorage data', () => {
      localStorage.setItem('queue:session-1', 'not-json{{{')

      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ sessionId: 'session-1' }),
      })

      expect(result.current.queueItems).toEqual([])
    })
  })

  describe('cancelQueuedItem', () => {
    it('removes item by id', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      let id
      act(() => {
        id = result.current.enqueueMessage('to cancel')
        result.current.enqueueMessage('keep')
      })

      act(() => {
        result.current.cancelQueuedItem(id)
      })

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('keep')
    })
  })

  describe('editQueuedItem', () => {
    it('removes and returns item for editing', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      let id
      act(() => {
        id = result.current.enqueueMessage('to edit')
      })

      let editedItem
      act(() => {
        editedItem = result.current.editQueuedItem(id)
      })

      expect(editedItem).toBeDefined()
      expect(editedItem.content).toBe('to edit')
      expect(result.current.queueItems).toHaveLength(0)
    })
  })

  describe('sendNowItem', () => {
    it('removes item and calls sendFn immediately', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      act(() => {
        result.current.enqueueMessage('first')
        result.current.enqueueMessage('second')
        result.current.enqueueMessage('third')
      })

      const secondId = result.current.queueItems[1].id

      act(() => {
        result.current.sendNowItem(secondId)
      })

      expect(sendFn).toHaveBeenCalledWith('second', null)
      expect(result.current.queueItems).toHaveLength(2)
      expect(result.current.queueItems[0].content).toBe('first')
      expect(result.current.queueItems[1].content).toBe('third')
    })

    it('sends with attachments', () => {
      const attachments = [{ id: 'a1', name: 'file.txt' }]
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      act(() => {
        result.current.enqueueMessage('with file', attachments)
      })

      const id = result.current.queueItems[0].id

      act(() => {
        result.current.sendNowItem(id)
      })

      expect(sendFn).toHaveBeenCalledWith('with file', attachments)
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('does not call sendFn for unknown id', () => {
      const { result } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps(),
      })

      act(() => {
        result.current.enqueueMessage('msg')
      })

      act(() => {
        result.current.sendNowItem('nonexistent')
      })

      expect(sendFn).not.toHaveBeenCalled()
      expect(result.current.queueItems).toHaveLength(1)
    })
  })

  describe('requeueItem', () => {
    it('transitions paused item back to queued', () => {
      const { result, rerender } = renderHook(props => useMessageQueue(props), {
        initialProps: defaultProps({ resultCount: 0 }),
      })

      act(() => {
        result.current.enqueueMessage('will pause')
      })

      // Pause via interrupt
      rerender(defaultProps({ resultCount: 0, interruptStatus: 'stopped' }))

      expect(result.current.queueItems[0].status).toBe('paused')

      const pausedId = result.current.queueItems[0].id

      act(() => {
        result.current.requeueItem(pausedId)
      })

      expect(result.current.queueItems[0].status).toBe('queued')
    })
  })
})
