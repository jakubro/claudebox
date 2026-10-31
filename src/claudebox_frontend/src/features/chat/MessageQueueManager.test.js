/** Tests for MessageQueueManager. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageQueueManager, { failedMessageItem, withSendFailure } from './MessageQueueManager'

describe('MessageQueueManager', () => {
  let manager
  let onChange

  beforeEach(() => {
    onChange = vi.fn()
    manager = new MessageQueueManager({ onChange })
  })

  describe('enqueue', () => {
    it('adds item with queued status and returns id', () => {
      const id = manager.enqueue('hello')
      expect(id).toBeTruthy()
      expect(manager.items).toHaveLength(1)
      expect(manager.items[0]).toMatchObject({
        id,
        content: 'hello',
        attachments: null,
        status: 'queued',
      })
    })

    it('preserves non-empty attachments', () => {
      const attachments = [{ name: 'file.txt' }]
      manager.enqueue('msg', attachments)
      expect(manager.items[0].attachments).toEqual(attachments)
    })

    it('normalizes empty attachments to null', () => {
      manager.enqueue('msg', [])
      expect(manager.items[0].attachments).toBeNull()
    })

    it('notifies on enqueue', () => {
      manager.enqueue('hello')
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ content: 'hello' })])
    })

    it('maintains FIFO order', () => {
      manager.enqueue('first')
      manager.enqueue('second')
      manager.enqueue('third')
      expect(manager.items.map(i => i.content)).toEqual(['first', 'second', 'third'])
    })
  })

  describe('dequeue', () => {
    it('removes and returns first queued item', () => {
      manager.enqueue('first')
      manager.enqueue('second')
      const item = manager.dequeue()
      expect(item.content).toBe('first')
      expect(manager.items).toHaveLength(1)
      expect(manager.items[0].content).toBe('second')
    })

    it('returns null when no queued items', () => {
      expect(manager.dequeue()).toBeNull()
    })

    it('skips paused items', () => {
      manager.enqueue('first')
      manager.enqueue('second')
      manager.pauseAll()
      manager.enqueue('third')
      const item = manager.dequeue()
      expect(item.content).toBe('third')
    })

    it('notifies on dequeue', () => {
      manager.enqueue('hello')
      onChange.mockClear()
      manager.dequeue()
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('does not notify when empty', () => {
      onChange.mockClear()
      manager.dequeue()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('peek', () => {
    it('returns first queued item without removing', () => {
      manager.enqueue('first')
      manager.enqueue('second')
      const item = manager.peek()
      expect(item.content).toBe('first')
      expect(manager.items).toHaveLength(2)
    })

    it('returns null when no queued items', () => {
      expect(manager.peek()).toBeNull()
    })

    it('skips paused items', () => {
      manager.enqueue('first')
      manager.pauseAll()
      manager.enqueue('second')
      expect(manager.peek().content).toBe('second')
    })
  })

  describe('editItem', () => {
    it('removes and returns item by id', () => {
      const id = manager.enqueue('editable')
      manager.enqueue('other')
      const item = manager.editItem(id)
      expect(item.content).toBe('editable')
      expect(manager.items).toHaveLength(1)
      expect(manager.items[0].content).toBe('other')
    })

    it('returns null for unknown id', () => {
      expect(manager.editItem('nonexistent')).toBeNull()
    })

    it('notifies on edit', () => {
      const id = manager.enqueue('msg')
      onChange.mockClear()
      manager.editItem(id)
      expect(onChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('sendNowItem', () => {
    it('removes and returns item by id', () => {
      manager.enqueue('first')
      const id2 = manager.enqueue('second')
      manager.enqueue('third')
      const item = manager.sendNowItem(id2)
      expect(item.content).toBe('second')
      expect(manager.items).toHaveLength(2)
      expect(manager.items.map(i => i.content)).toEqual(['first', 'third'])
    })

    it('returns null for unknown id', () => {
      expect(manager.sendNowItem('nonexistent')).toBeNull()
    })

    it('works on paused items', () => {
      const id = manager.enqueue('paused msg')
      manager.pauseAll()
      const item = manager.sendNowItem(id)
      expect(item.content).toBe('paused msg')
      expect(item.status).toBe('paused')
      expect(manager.items).toHaveLength(0)
    })

    it('notifies on removal', () => {
      const id = manager.enqueue('msg')
      onChange.mockClear()
      manager.sendNowItem(id)
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('does not notify for unknown id', () => {
      onChange.mockClear()
      manager.sendNowItem('nonexistent')
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('a failed send', () => {
    it('returns its item first and pauses every queued item', () => {
      const items = [
        { id: 'x', content: 'x', attachments: null, status: 'queued', addedAt: 1 },
        { id: 'y', content: 'y', attachments: null, status: 'paused', addedAt: 2 },
      ]
      const failed = { id: 'f', content: 'f', attachments: null, status: 'queued', addedAt: 0 }

      expect(withSendFailure(items, failed).map(i => [i.id, i.status])).toEqual([
        ['f', 'paused'],
        ['x', 'paused'],
        ['y', 'paused'],
      ])
    })

    it('leaves items held for a creation queued', () => {
      const held = { id: 'h', content: 'h', status: 'queued', owner: { creation: 1 } }

      expect(withSendFailure([held])).toEqual([held])
    })

    it('pauses everything in memory with no item to return, notifying once', () => {
      manager.enqueue('a')
      manager.enqueue('b')
      onChange.mockClear()

      manager.handleSendFailure()

      expect(manager.items.map(i => i.status)).toEqual(['paused', 'paused'])
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('builds a paused item for a message that was never queued', () => {
      expect(failedMessageItem('never queued', [])).toMatchObject({
        content: 'never queued',
        attachments: null,
        status: 'paused',
      })
    })
  })

  describe('cancelItem', () => {
    it('removes item by id', () => {
      const id = manager.enqueue('cancel-me')
      manager.enqueue('keep-me')
      manager.cancelItem(id)
      expect(manager.items).toHaveLength(1)
      expect(manager.items[0].content).toBe('keep-me')
    })

    it('does nothing for unknown id', () => {
      manager.enqueue('msg')
      onChange.mockClear()
      manager.cancelItem('nonexistent')
      expect(onChange).not.toHaveBeenCalled()
      expect(manager.items).toHaveLength(1)
    })
  })

  describe('pauseAll', () => {
    it('transitions all queued items to paused', () => {
      manager.enqueue('a')
      manager.enqueue('b')
      manager.pauseAll()
      expect(manager.items.every(i => i.status === 'paused')).toBe(true)
    })

    it('does not affect already paused items', () => {
      manager.enqueue('a')
      manager.pauseAll()
      onChange.mockClear()
      manager.pauseAll()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('notifies when items are paused', () => {
      manager.enqueue('a')
      onChange.mockClear()
      manager.pauseAll()
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('does not notify when no queued items', () => {
      onChange.mockClear()
      manager.pauseAll()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('requeueItem', () => {
    it('transitions paused item back to queued', () => {
      const id = manager.enqueue('msg')
      manager.pauseAll()
      manager.requeueItem(id)
      expect(manager.items[0].status).toBe('queued')
    })

    it('does nothing for already queued item', () => {
      const id = manager.enqueue('msg')
      onChange.mockClear()
      manager.requeueItem(id)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('does nothing for unknown id', () => {
      onChange.mockClear()
      manager.requeueItem('nonexistent')
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('restore', () => {
    it('replaces all items and notifies', () => {
      manager.enqueue('old')
      onChange.mockClear()
      const items = [
        { id: 'r1', content: 'restored', attachments: null, status: 'queued', addedAt: 1 },
      ]
      manager.restore(items)
      expect(manager.items).toEqual(items)
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('restores empty array', () => {
      manager.enqueue('old')
      onChange.mockClear()
      manager.restore([])
      expect(manager.items).toHaveLength(0)
      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('items held for a creation', () => {
    const HELD = { owner: { creation: 3 } }

    it('are skipped by drain, peek and hasQueued', () => {
      manager.enqueue('for the new session', null, HELD)

      expect(manager.hasQueued()).toBe(false)
      expect(manager.peek()).toBeNull()
      expect(manager.dequeue()).toBeNull()
      expect(manager.items).toHaveLength(1)
    })

    it('are refused by send-now', () => {
      const id = manager.enqueue('for the new session', null, HELD)

      expect(manager.sendNowItem(id)).toBeNull()
      expect(manager.items).toHaveLength(1)
    })

    it('stay queued when the rest pauses', () => {
      manager.enqueue('here')
      manager.enqueue('for the new session', null, HELD)

      manager.handleSendFailure()

      expect(manager.items.map(i => i.status)).toEqual(['paused', 'queued'])
    })

    it('survive a restore of the stored queue', () => {
      manager.enqueue('for the new session', null, HELD)
      const stored = [
        { id: 's1', content: 'stored', attachments: null, status: 'queued', addedAt: 1 },
      ]

      manager.restore(stored)

      expect(manager.items.map(i => i.content)).toEqual(['stored', 'for the new session'])
    })

    it('are taken back in order, leaving the rest', () => {
      manager.enqueue('first', null, HELD)
      manager.enqueue('mine')
      manager.enqueue('second', null, HELD)
      manager.enqueue('another creation', null, { owner: { creation: 4 } })

      const taken = manager.takeCreation(3)

      expect(taken.map(i => i.content)).toEqual(['first', 'second'])
      expect(manager.items.map(i => i.content)).toEqual(['mine', 'another creation'])
    })

    it('become ordinary items once adopted', () => {
      manager.enqueue('for the new session', null, HELD)

      manager.adoptCreation(3)

      expect(manager.items[0].owner).toBeUndefined()
      expect(manager.dequeue().content).toBe('for the new session')
    })

    it('are only held for a creation, never for a named session', () => {
      manager.enqueue('here', null, { owner: { sessionId: 'A' } })

      expect(manager.hasQueued()).toBe(true)
    })
  })
  describe('clearAll', () => {
    it('empties the queue', () => {
      manager.enqueue('a')
      manager.enqueue('b')
      manager.clearAll()
      expect(manager.items).toHaveLength(0)
    })

    it('notifies when cleared', () => {
      manager.enqueue('a')
      onChange.mockClear()
      manager.clearAll()
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([])
    })

    it('does not notify when already empty', () => {
      onChange.mockClear()
      manager.clearAll()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('hasQueued', () => {
    it('returns false when empty', () => {
      expect(manager.hasQueued()).toBe(false)
    })

    it('returns true when queued items exist', () => {
      manager.enqueue('msg')
      expect(manager.hasQueued()).toBe(true)
    })

    it('returns false when all paused', () => {
      manager.enqueue('msg')
      manager.pauseAll()
      expect(manager.hasQueued()).toBe(false)
    })

    it('returns true when mix of paused and queued', () => {
      manager.enqueue('a')
      manager.pauseAll()
      manager.enqueue('b')
      expect(manager.hasQueued()).toBe(true)
    })
  })

  describe('lifecycle handlers', () => {
    it('handleResponseCycleEnd dequeues next item', () => {
      manager.enqueue('auto-send')
      const item = manager.handleResponseCycleEnd()
      expect(item.content).toBe('auto-send')
      expect(manager.items).toHaveLength(0)
    })

    it('handleResponseCycleEnd returns null when empty', () => {
      expect(manager.handleResponseCycleEnd()).toBeNull()
    })

    it('handleInterrupt pauses all', () => {
      manager.enqueue('a')
      manager.enqueue('b')
      manager.handleInterrupt()
      expect(manager.items.every(i => i.status === 'paused')).toBe(true)
    })
  })

  describe('onChange snapshot isolation', () => {
    it('provides a copy, not a reference', () => {
      manager.enqueue('msg')
      const snapshot = onChange.mock.calls[0][0]
      snapshot.push({ id: 'fake' })
      expect(manager.items).toHaveLength(1)
    })
  })
})
