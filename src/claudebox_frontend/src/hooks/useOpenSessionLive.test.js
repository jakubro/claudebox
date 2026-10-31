/** Tests for useOpenSessionLive. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

let mockStatus
const derive = vi.fn(() => mockStatus)

vi.mock('../context/ContainerMapContext', () => ({
  useContainerMap: () => ({ deriveSessionStatus: derive }),
}))
vi.mock('../context/SessionsContext', () => ({ useSessionsList: () => ({ sessions: ['s'] }) }))
vi.mock('../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ activeSessionId: 'sess-1' }),
}))

import useOpenSessionLive from './useOpenSessionLive'

describe('useOpenSessionLive', () => {
  it.each([
    ['running', true],
    ['stopping', false],
    ['none', false],
  ])('reads a %s container as live=%s', (status, live) => {
    mockStatus = status

    expect(renderHook(() => useOpenSessionLive()).result.current).toBe(live)
    expect(derive).toHaveBeenCalledWith('sess-1', ['s'])
  })
})
