/** Tests for useCapabilities hook. */

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockCapabilities } from '../test-utils/mockCapabilities'
import useCapabilities from './useCapabilities'

vi.mock('../context/SessionDataContext', () => ({
  useSessionData: vi.fn(),
}))

vi.mock('./useSessionDefaults', () => ({
  default: vi.fn(),
}))

import { useSessionData } from '../context/SessionDataContext'
import useSessionDefaults from './useSessionDefaults'

afterEach(() => {
  vi.clearAllMocks()
})

describe('useCapabilities', () => {
  it('returns capabilities and runtimeName from sessionData', () => {
    const caps = mockCapabilities()
    useSessionData.mockReturnValue({ capabilities: caps, runtimeName: 'Claude' })
    useSessionDefaults.mockReturnValue(null)

    const { result } = renderHook(() => useCapabilities())

    expect(result.current.capabilities).toBe(caps)
    expect(result.current.runtimeName).toBe('Claude')
  })

  it('falls back to sessionDefaults when sessionData has no capabilities', () => {
    const caps = mockCapabilities({ supports_skills: false })
    useSessionData.mockReturnValue({ capabilities: null, runtimeName: null })
    useSessionDefaults.mockReturnValue({ capabilities: caps, runtime_name: 'Claude' })

    const { result } = renderHook(() => useCapabilities())

    expect(result.current.capabilities).toBe(caps)
    expect(result.current.runtimeName).toBe('Claude')
  })

  it('returns null for both during the race window', () => {
    useSessionData.mockReturnValue({ capabilities: null, runtimeName: null })
    useSessionDefaults.mockReturnValue(null)

    const { result } = renderHook(() => useCapabilities())

    expect(result.current.capabilities).toBeNull()
    expect(result.current.runtimeName).toBeNull()
  })

  it('prefers sessionData over sessionDefaults when both are present', () => {
    const sessionCaps = mockCapabilities({ supports_skills: true })
    const defaultsCaps = mockCapabilities({ supports_skills: false })
    useSessionData.mockReturnValue({ capabilities: sessionCaps, runtimeName: 'Claude' })
    useSessionDefaults.mockReturnValue({ capabilities: defaultsCaps, runtime_name: 'Goose' })

    const { result } = renderHook(() => useCapabilities())

    expect(result.current.capabilities).toBe(sessionCaps)
    expect(result.current.runtimeName).toBe('Claude')
  })
})
