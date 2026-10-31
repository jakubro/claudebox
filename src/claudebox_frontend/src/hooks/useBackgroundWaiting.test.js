/** Tests for useBackgroundWaiting. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const RUNNING = [{ id: 'b1', name: 'Wait', toolUseId: 'tu1', index: 2 }]
let mockEvents
let mockStatus

vi.mock('../context/EventsContext', () => ({ useEvents: () => mockEvents }))
vi.mock('../context/ContainerMapContext', () => ({
  useContainerMap: () => ({ deriveSessionStatus: () => mockStatus }),
}))
vi.mock('../context/SessionsContext', () => ({ useSessionsList: () => ({ sessions: [] }) }))
vi.mock('../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ activeSessionId: 's1' }),
}))

import useBackgroundWaiting from './useBackgroundWaiting'

describe('useBackgroundWaiting', () => {
  beforeEach(() => {
    mockEvents = { isResponding: false, awaitingPickup: false, runningBackgroundWork: RUNNING }
    mockStatus = 'running'
  })

  it('waits when no turn runs and work is still running', () => {
    const { result } = renderHook(() => useBackgroundWaiting())

    expect(result.current.isWaiting).toBe(true)
    expect(result.current.runningBackgroundWork).toBe(RUNNING)
  })

  it('does not wait while a turn runs', () => {
    mockEvents.isResponding = true

    expect(renderHook(() => useBackgroundWaiting()).result.current.isWaiting).toBe(false)
  })

  it('does not wait between a completion and the pick-up', () => {
    mockEvents.awaitingPickup = true

    const { result } = renderHook(() => useBackgroundWaiting())

    expect(result.current.isWaiting).toBe(false)
    expect(result.current.awaitingPickup).toBe(true)
  })

  it('does not wait with nothing running', () => {
    mockEvents.runningBackgroundWork = []

    expect(renderHook(() => useBackgroundWaiting()).result.current.isWaiting).toBe(false)
  })

  it.each(['none', 'stopping'])(
    'neither waits nor awaits a pick-up when the container is %s',
    status => {
      mockStatus = status
      mockEvents.awaitingPickup = true

      const { result } = renderHook(() => useBackgroundWaiting())

      expect(result.current.isWaiting).toBe(false)
      expect(result.current.awaitingPickup).toBe(false)
    },
  )
})
