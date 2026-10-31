/** Tests for createRowSizeStore - per-turn sizes with frame-coalesced notification. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRowSizeStore } from './rowSizeStore'

describe('createRowSizeStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns what was set, immediately', () => {
    const store = createRowSizeStore()
    store.set('a', 120)

    expect(store.get('a')).toBe(120)
    expect(store.get('b')).toBeUndefined()
  })

  it('notifies once per frame however many sizes land in it', () => {
    const store = createRowSizeStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set('a', 120)
    store.set('b', 340)
    store.set('a', 130)
    expect(listener).not.toHaveBeenCalled()

    vi.advanceTimersToNextFrame()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getVersion()).toBe(1)
  })

  it('stays silent when a size is set to the value it already has', () => {
    const store = createRowSizeStore()
    store.set('a', 120)
    vi.advanceTimersToNextFrame()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set('a', 120)
    vi.advanceTimersToNextFrame()

    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies when a size is deleted, and only when one existed', () => {
    const store = createRowSizeStore()
    store.set('a', 120)
    vi.advanceTimersToNextFrame()
    const listener = vi.fn()
    store.subscribe(listener)

    store.delete('missing')
    vi.advanceTimersToNextFrame()
    expect(listener).not.toHaveBeenCalled()

    store.delete('a')
    vi.advanceTimersToNextFrame()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.get('a')).toBeUndefined()
  })

  it('stops notifying a listener once it unsubscribes', () => {
    const store = createRowSizeStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()

    store.set('a', 120)
    vi.advanceTimersToNextFrame()

    expect(listener).not.toHaveBeenCalled()
  })
})
