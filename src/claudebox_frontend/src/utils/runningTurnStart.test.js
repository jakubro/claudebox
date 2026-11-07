/** Tests for the running turn's start held for readers outside the transcript. */

import { describe, expect, it, vi } from 'vitest'
import {
  holdRunningTurnStart,
  runningTurnStart,
  subscribeRunningTurnStart,
} from './runningTurnStart'

describe('runningTurnStart', () => {
  it('holds a start until its release', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRunningTurnStart(listener)

    const release = holdRunningTurnStart(5_000)
    expect(runningTurnStart()).toBe(5_000)
    release()

    expect(runningTurnStart()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('keeps a later hold when an earlier one is released', () => {
    const releaseEarlier = holdRunningTurnStart(5_000)
    const releaseLater = holdRunningTurnStart(9_000)

    releaseEarlier()

    expect(runningTurnStart()).toBe(9_000)
    releaseLater()
    expect(runningTurnStart()).toBeNull()
  })
})
