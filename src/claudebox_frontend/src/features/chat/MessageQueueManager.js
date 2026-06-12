/** Coordinate message queue state: enqueue, drain, pause, and lifecycle transitions. */

import { QueueStatus } from '../../config/schema'

export default class MessageQueueManager {
  /**
   * @param {object} options
   * @param {function} [options.onChange] - Callback with items snapshot after every mutation.
   */
  constructor({ onChange } = {}) {
    this.items = []
    this.onChange = onChange
  }

  /** Notify listener with shallow copy of current items. */
  _notify() {
    this.onChange?.([...this.items])
  }

  /** Append a queued message and return its id. */
  enqueue(content, attachments = null) {
    const id = crypto.randomUUID()
    this.items.push({
      id,
      content,
      attachments: attachments?.length ? attachments : null,
      status: QueueStatus.QUEUED,
      addedAt: Date.now(),
    })
    this._notify()
    return id
  }

  /** Remove and return first queued item, or null if none. */
  dequeue() {
    const idx = this.items.findIndex(i => i.status === QueueStatus.QUEUED)
    if (idx === -1) {
      return null
    }
    const [item] = this.items.splice(idx, 1)
    this._notify()
    return item
  }

  /** Return first queued item without removing, or null. */
  peek() {
    return this.items.find(i => i.status === QueueStatus.QUEUED) || null
  }

  /** Remove and return item by id, or null if not found. */
  _removeById(id) {
    const idx = this.items.findIndex(i => i.id === id)
    if (idx === -1) {
      return null
    }
    const [item] = this.items.splice(idx, 1)
    this._notify()
    return item
  }

  /** Remove item by id and return it (for editing). */
  editItem(id) {
    return this._removeById(id)
  }

  /** Remove item by id and return it (for immediate sending). */
  sendNowItem(id) {
    return this._removeById(id)
  }

  /** Remove item by id entirely. */
  cancelItem(id) {
    const idx = this.items.findIndex(i => i.id === id)
    if (idx === -1) {
      return
    }
    this.items.splice(idx, 1)
    this._notify()
  }

  /** Transition all queued items to paused. */
  pauseAll() {
    let changed = false
    this.items = this.items.map(item => {
      if (item.status === QueueStatus.QUEUED) {
        changed = true
        return { ...item, status: QueueStatus.PAUSED }
      }
      return item
    })
    if (changed) {
      this._notify()
    }
  }

  /** Transition a paused item back to queued. */
  requeueItem(id) {
    const idx = this.items.findIndex(i => i.id === id)
    if (idx === -1 || this.items[idx].status !== QueueStatus.PAUSED) {
      return
    }
    this.items[idx] = { ...this.items[idx], status: QueueStatus.QUEUED }
    this._notify()
  }

  /** Replace all items (for hydration from storage). */
  restore(items) {
    this.items = items
    this._notify()
  }

  /** Merge stored items with in-memory orphans not yet persisted. */
  mergeRestore(storedItems) {
    const storedIds = new Set(storedItems.map(i => i.id))
    const orphans = this.items.filter(i => !storedIds.has(i.id))
    this.items = [...storedItems, ...orphans]
    this._notify()
  }

  /** Empty the queue. */
  clearAll() {
    if (this.items.length === 0) {
      return
    }
    this.items = []
    this._notify()
  }

  /** Check if any items have queued status. */
  hasQueued() {
    return this.items.some(i => i.status === QueueStatus.QUEUED)
  }

  /** Handle response cycle end - dequeue next item for sending. */
  handleResponseCycleEnd() {
    return this.dequeue()
  }

  /** Handle interrupt - pause all queued items. */
  handleInterrupt() {
    this.pauseAll()
  }

  /** Handle error - pause all queued items. */
  handleError() {
    this.pauseAll()
  }
}
