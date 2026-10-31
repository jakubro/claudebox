/** Tests for useMessageQueue hook. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useMessageQueue from './useMessageQueue'

const OWN = { sessionId: 'session-1', containerId: 'container-1' }

describe('useMessageQueue', () => {
  let sendFn

  beforeEach(() => {
    sendFn = vi.fn(() => Promise.resolve(true))
    localStorage.clear()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `test-uuid-${Math.random().toString(36).slice(2)}`),
    })
  })

  function renderQueue(overrides) {
    return renderHook(props => useMessageQueue(props), { initialProps: defaultProps(overrides) })
  }

  function defaultProps(overrides = {}) {
    return {
      resultCount: 0,
      compactionCount: 0,
      isLoading: false,
      interruptStatus: null,
      sessionId: 'session-1',
      containerId: 'container-1',
      sendFn,
      ...overrides,
    }
  }

  describe('enqueue and queue state', () => {
    it('starts with empty queue', () => {
      const { result } = renderQueue()

      expect(result.current.queueItems).toEqual([])
    })

    it('enqueueMessage adds item to queue', () => {
      const { result } = renderQueue()

      act(() => {
        result.current.enqueueMessage('hello')
      })

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('hello')
      expect(result.current.queueItems[0].status).toBe('queued')
    })

    it('enqueueMessage stores attachments', () => {
      const { result } = renderQueue()

      const attachments = [{ id: 'a1', name: 'file.txt' }]
      act(() => {
        result.current.enqueueMessage('with file', attachments)
      })

      expect(result.current.queueItems[0].attachments).toEqual(attachments)
    })

    it('enqueueMessage sets attachments to null for empty array', () => {
      const { result } = renderQueue()

      act(() => {
        result.current.enqueueMessage('no files', [])
      })

      expect(result.current.queueItems[0].attachments).toBeNull()
    })

    it('returnFailedMessage adds item already paused', () => {
      const { result } = renderQueue()

      act(() => {
        result.current.returnFailedMessage('session-1', 'hello')
      })

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('hello')
      expect(result.current.queueItems[0].status).toBe('paused')
    })

    it('enqueues multiple items in order', () => {
      const { result } = renderQueue()

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
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('queued msg')
      })

      expect(result.current.queueItems).toHaveLength(1)

      // Increment resultCount to trigger drain
      rerender(defaultProps({ resultCount: 1 }))

      expect(sendFn).toHaveBeenCalledWith('queued msg', { attachments: null, target: OWN })
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('drains with attachments when resultCount increments', () => {
      const attachments = [{ id: 'a1', name: 'img.png' }]
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('with attachment', attachments)
      })

      rerender(defaultProps({ resultCount: 1 }))

      expect(sendFn).toHaveBeenCalledWith('with attachment', { attachments, target: OWN })
    })

    it('drains one item per resultCount increment', () => {
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('first')
        result.current.enqueueMessage('second')
      })

      expect(result.current.queueItems).toHaveLength(2)

      // First drain
      rerender(defaultProps({ resultCount: 1 }))

      expect(sendFn).toHaveBeenCalledTimes(1)
      expect(sendFn).toHaveBeenCalledWith('first', { attachments: null, target: OWN })
      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('second')

      // Second drain
      rerender(defaultProps({ resultCount: 2 }))

      expect(sendFn).toHaveBeenCalledTimes(2)
      expect(sendFn).toHaveBeenLastCalledWith('second', { attachments: null, target: OWN })
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('does not drain when resultCount stays the same', () => {
      const { result, rerender } = renderQueue({ resultCount: 0 })

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
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('msg')
      })

      // Jump from 0 to 5 (still triggers since 5 > 0)
      rerender(defaultProps({ resultCount: 5 }))

      expect(sendFn).toHaveBeenCalledTimes(1)
      expect(sendFn).toHaveBeenCalledWith('msg', { attachments: null, target: OWN })
    })
  })

  describe('drain is held while a stored conversation loads', () => {
    it('does not send while loading, however far the counter climbs', () => {
      const { result, rerender } = renderQueue({ isLoading: true, resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('typed during load')
      })

      // Replaying stored responses walks the counter up by many.
      rerender(defaultProps({ isLoading: true, resultCount: 12 }))
      rerender(defaultProps({ isLoading: true, resultCount: 37 }))

      expect(sendFn).not.toHaveBeenCalled()
      expect(result.current.queueItems).toHaveLength(1)
    })

    it('does not send on the commit that ends the load', () => {
      const { result, rerender } = renderQueue({ isLoading: true, resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('queued before the load ended')
      })

      // The final replay slice and the replay-ended dispatch land in ONE commit, so the counter jump
      // arrives with the flag turning false. That jump is replayed history, not a live cycle.
      rerender(defaultProps({ isLoading: false, resultCount: 37 }))

      expect(sendFn).not.toHaveBeenCalled()
      expect(result.current.queueItems).toHaveLength(1)
    })

    it('drains on the first live completion after the load, one item at a time', () => {
      const { result, rerender } = renderQueue({ isLoading: true, resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('first')
        result.current.enqueueMessage('second')
      })

      rerender(defaultProps({ isLoading: false, resultCount: 40 }))

      expect(sendFn).not.toHaveBeenCalled()

      // A genuine live completion drains exactly one, proving the counter was re-synced across the
      // load rather than left behind at its pre-load value.
      rerender(defaultProps({ isLoading: false, resultCount: 41 }))

      expect(sendFn).toHaveBeenCalledTimes(1)
      expect(sendFn).toHaveBeenCalledWith('first', { attachments: null, target: OWN })

      rerender(defaultProps({ isLoading: false, resultCount: 42 }))

      expect(sendFn).toHaveBeenCalledTimes(2)
      expect(sendFn).toHaveBeenLastCalledWith('second', { attachments: null, target: OWN })
    })

    it('holds the compaction-driven drain too', () => {
      const { result, rerender } = renderQueue({ isLoading: true, compactionCount: 0 })

      act(() => {
        result.current.enqueueMessage('queued before the load ended')
      })

      // A stored conversation containing a compaction replays its boundary.
      rerender(defaultProps({ isLoading: true, compactionCount: 3 }))
      rerender(defaultProps({ isLoading: false, compactionCount: 3 }))

      expect(sendFn).not.toHaveBeenCalled()

      rerender(defaultProps({ isLoading: false, compactionCount: 4 }))

      expect(sendFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('drain on compactionCount increment', () => {
    it('drains queued item when compactionCount increments', () => {
      const { result, rerender } = renderQueue({ compactionCount: 0 })

      act(() => {
        result.current.enqueueMessage('queued during compaction')
      })

      expect(result.current.queueItems).toHaveLength(1)

      rerender(defaultProps({ compactionCount: 1 }))

      expect(sendFn).toHaveBeenCalledWith('queued during compaction', {
        attachments: null,
        target: OWN,
      })
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('does not drain when compactionCount stays the same', () => {
      const { result, rerender } = renderQueue({ compactionCount: 0 })

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
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('to pause')
      })

      rerender(defaultProps({ resultCount: 0, interruptStatus: 'stopping' }))

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].status).toBe('paused')
    })

    it('pauses queued items on interrupt stopped', () => {
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('to pause')
      })

      rerender(defaultProps({ resultCount: 0, interruptStatus: 'stopped' }))

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].status).toBe('paused')
    })

    it('does not pause on unrelated interrupt status', () => {
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('stay queued')
      })

      rerender(defaultProps({ resultCount: 0, interruptStatus: 'other' }))

      expect(result.current.queueItems[0].status).toBe('queued')
    })
  })

  describe('a failed send', () => {
    const stored = id =>
      JSON.parse(localStorage.getItem(`queue:${id}`)).map(i => [i.content, i.status])

    function seed(id, contents) {
      localStorage.setItem(
        `queue:${id}`,
        JSON.stringify(
          contents.map((content, n) => ({
            id: `${id}-${n}`,
            content,
            attachments: null,
            status: 'queued',
            addedAt: n,
          })),
        ),
      )
    }

    it.each([
      ['on another session', ['A', null, 'B']],
      ['while nothing is attached', ['A', null]],
    ])(
      'pauses and returns to the queue it was sent from when it lands %s',
      async (_label, route) => {
        seed('A', ['a one', 'a two'])
        seed('B', ['b one'])
        let fail
        sendFn = vi.fn(
          () =>
            new Promise(resolve => {
              fail = () => resolve(false)
            }),
        )
        const { rerender } = renderHook(props => useMessageQueue(props), {
          initialProps: defaultProps({ sessionId: 'A' }),
        })
        rerender(defaultProps({ sessionId: 'A', resultCount: 1 }))
        for (const id of route.slice(1)) {
          rerender(defaultProps({ sessionId: id, resultCount: 1 }))
        }

        await act(async () => {
          fail()
        })

        expect(stored('A')).toEqual([
          ['a one', 'paused'],
          ['a two', 'paused'],
        ])
        expect(stored('B')).toEqual([['b one', 'queued']])
      },
    )

    it('pauses the open session when its own send fails, every time', async () => {
      sendFn = vi.fn(() => Promise.resolve(false))
      const { result } = renderQueue()
      act(() => {
        result.current.enqueueMessage('b one')
      })

      await act(async () => {
        await result.current.send('typed', {})
      })
      expect(result.current.queueItems[0].status).toBe('paused')

      act(() => {
        result.current.requeueItem(result.current.queueItems[0].id)
      })
      await act(async () => {
        await result.current.send('typed again', {})
      })
      expect(result.current.queueItems[0].status).toBe('paused')
    })
  })

  describe('session change', () => {
    it('clears queue on session change when new session has no stored data', () => {
      const { result, rerender } = renderQueue({ resultCount: 0, sessionId: 'session-1' })

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

      const { result, rerender } = renderQueue({ resultCount: 0, sessionId: 'session-1' })

      rerender(defaultProps({ resultCount: 0, sessionId: 'session-2' }))

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('stored msg')
    })
  })

  describe('items held for a creation', () => {
    const HELD = { creation: 1 }

    it('survive the session left coming back, and are never saved under it', () => {
      const { result, rerender } = renderQueue({ sessionId: 'A' })
      rerender(defaultProps({ sessionId: null }))

      act(() => {
        result.current.enqueueMessage('queued for new', null, HELD)
      })
      rerender(defaultProps({ sessionId: 'A' }))

      expect(result.current.queueItems.map(i => i.content)).toEqual(['queued for new'])
      expect(localStorage.getItem('queue:A')).toBeNull()
    })

    it('are saved under the session that adopts them', () => {
      const { result, rerender } = renderQueue({ sessionId: null })
      act(() => {
        result.current.enqueueMessage('queued for new', null, HELD)
      })
      rerender(defaultProps({ sessionId: 'new-session' }))

      act(() => {
        result.current.adoptCreation(1)
      })

      expect(JSON.parse(localStorage.getItem('queue:new-session'))[0].content).toBe(
        'queued for new',
      )
    })

    it('do not keep an item queued with no session once one attaches', () => {
      const { result, rerender } = renderQueue({ sessionId: null })
      act(() => {
        result.current.enqueueMessage('no owner')
      })

      rerender(defaultProps({ sessionId: 'A' }))

      expect(result.current.queueItems).toHaveLength(0)
    })

    it('clears queue on explicit session switch (value -> null -> value)', () => {
      const { result, rerender } = renderQueue({ sessionId: 'session-1' })

      act(() => {
        result.current.enqueueMessage('session-1 msg')
      })

      rerender(defaultProps({ sessionId: null }))
      expect(result.current.queueItems).toHaveLength(0)

      rerender(defaultProps({ sessionId: 'session-2' }))
      expect(result.current.queueItems).toHaveLength(0)
    })
  })

  describe('localStorage persistence', () => {
    it('persists queue to localStorage on enqueue', () => {
      const { result } = renderQueue({ sessionId: 'session-1' })

      act(() => {
        result.current.enqueueMessage('persist me')
      })

      const stored = JSON.parse(localStorage.getItem('queue:session-1'))
      expect(stored).toHaveLength(1)
      expect(stored[0].content).toBe('persist me')
    })

    it('removes localStorage key when queue is emptied', () => {
      const { result } = renderQueue({ sessionId: 'session-1' })

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

      const { result } = renderQueue({ sessionId: 'session-1' })

      expect(result.current.queueItems).toEqual([])
    })
  })

  describe('cancelQueuedItem', () => {
    it('removes item by id', () => {
      const { result } = renderQueue()

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
      const { result } = renderQueue()

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
      const { result } = renderQueue()

      act(() => {
        result.current.enqueueMessage('first')
        result.current.enqueueMessage('second')
        result.current.enqueueMessage('third')
      })

      const secondId = result.current.queueItems[1].id

      act(() => {
        result.current.sendNowItem(secondId)
      })

      expect(sendFn).toHaveBeenCalledWith('second', { attachments: null, target: OWN })
      expect(result.current.queueItems).toHaveLength(2)
      expect(result.current.queueItems[0].content).toBe('first')
      expect(result.current.queueItems[1].content).toBe('third')
    })

    it('sends with attachments', () => {
      const attachments = [{ id: 'a1', name: 'file.txt' }]
      const { result } = renderQueue()

      act(() => {
        result.current.enqueueMessage('with file', attachments)
      })

      const id = result.current.queueItems[0].id

      act(() => {
        result.current.sendNowItem(id)
      })

      expect(sendFn).toHaveBeenCalledWith('with file', { attachments, target: OWN })
      expect(result.current.queueItems).toHaveLength(0)
    })

    it('does not call sendFn for unknown id', () => {
      const { result } = renderQueue()

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
      const { result, rerender } = renderQueue({ resultCount: 0 })

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

  describe('a failed drain returns the item to the queue', () => {
    it('reinserts as paused rather than dropping it', async () => {
      sendFn.mockResolvedValueOnce(false)
      const { result, rerender } = renderQueue({ resultCount: 0 })

      act(() => {
        result.current.enqueueMessage('will fail')
      })

      await act(async () => {
        rerender(defaultProps({ resultCount: 1 }))
      })

      expect(sendFn).toHaveBeenCalledWith('will fail', { attachments: null, target: OWN })
      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].content).toBe('will fail')
      expect(result.current.queueItems[0].status).toBe('paused')
    })

    it('sendNowItem does the same', async () => {
      sendFn.mockResolvedValueOnce(false)
      const { result } = renderQueue()

      let id
      act(() => {
        id = result.current.enqueueMessage('send now, but fails')
      })

      await act(async () => {
        await result.current.sendNowItem(id)
      })

      expect(result.current.queueItems).toHaveLength(1)
      expect(result.current.queueItems[0].status).toBe('paused')
    })
  })
})
