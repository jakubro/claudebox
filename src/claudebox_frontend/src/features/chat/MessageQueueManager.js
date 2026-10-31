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

  /**
   * Append a queued message and return its id. An item owned by a creation is held - never
   * drained, sent or paused - until that creation's session adopts it.
   */
  enqueue(content, attachments = null, { owner } = {}) {
    const id = crypto.randomUUID()
    this.items.push({
      id,
      content,
      attachments: attachments?.length ? attachments : null,
      status: QueueStatus.QUEUED,
      addedAt: Date.now(),
      ...(owner?.creation !== undefined && { owner: { creation: owner.creation } }),
    })
    this._notify()
    return id
  }

  /** Remove and return first queued item, or null if none. */
  dequeue() {
    const idx = this.items.findIndex(isSendable)
    if (idx === -1) {
      return null
    }
    const [item] = this.items.splice(idx, 1)
    this._notify()
    return item
  }

  /** Return first queued item without removing, or null. */
  peek() {
    return this.items.find(isSendable) || null
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

  /** Remove item by id and return it (for immediate sending); a held item stays. */
  sendNowItem(id) {
    if (this.items.find(i => i.id === id)?.owner) {
      return null
    }
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

  /** Apply a failed send: `failedItem`, if any, returns first and every sendable item pauses. */
  handleSendFailure(failedItem = null) {
    this.items = withSendFailure(this.items, failedItem)
    this._notify()
  }

  /** Transition all queued items to paused. */
  pauseAll() {
    let changed = false
    this.items = this.items.map(item => {
      if (isSendable(item)) {
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

  /** Replace all items with a session's stored ones (hydration), keeping held items. */
  restore(items) {
    this.items = [...items, ...this.items.filter(i => i.owner)]
    this._notify()
  }

  /** Remove and return, in order, the items held for creation `seq`. */
  takeCreation(seq) {
    const taken = this.items.filter(i => i.owner?.creation === seq)
    if (taken.length === 0) {
      return []
    }
    this.items = this.items.filter(i => i.owner?.creation !== seq)
    this._notify()
    return taken
  }

  /** Release the items held for creation `seq` into the queue of the session it produced. */
  adoptCreation(seq) {
    if (!this.items.some(i => i.owner?.creation === seq)) {
      return
    }
    this.items = this.items.map(item => {
      if (item.owner?.creation !== seq) {
        return item
      }
      const { owner: _, ...adopted } = item
      return adopted
    })
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
    return this.items.some(isSendable)
  }

  /** Handle response cycle end - dequeue next item for sending. */
  handleResponseCycleEnd() {
    return this.dequeue()
  }

  /** Handle interrupt - pause all queued items. */
  handleInterrupt() {
    this.pauseAll()
  }
}

/** A queue after a failed send: the failed item, if any, first and paused; every sendable item paused. */
export function withSendFailure(items, failedItem = null) {
  const paused = items.map(item =>
    isSendable(item) ? { ...item, status: QueueStatus.PAUSED } : item,
  )

  return failedItem ? [{ ...failedItem, status: QueueStatus.PAUSED }, ...paused] : paused
}

/** A queue item for a message that failed before it was ever queued. */
export function failedMessageItem(content, attachments = null) {
  return {
    id: crypto.randomUUID(),
    content,
    attachments: attachments?.length ? attachments : null,
    status: QueueStatus.PAUSED,
    addedAt: Date.now(),
  }
}

function isSendable(item) {
  return item.status === QueueStatus.QUEUED && !item.owner
}
