/** Tests for usePathResolution hook. */

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pathResolutionManager } from '../managers/PathResolutionManager'
import usePathResolution from './usePathResolution'

const mockResolvePaths = vi.fn()

vi.mock('../api/pathResolution', () => ({
  resolvePaths: (...args) => mockResolvePaths(...args),
}))

vi.mock('../context/SessionDataContext', () => ({
  useSessionId: () => 'test-session',
}))

describe('usePathResolution', () => {
  beforeEach(() => {
    mockResolvePaths.mockReset()
    pathResolutionManager.reset()
    // Pre-set session so the hook's setSessionId('test-session') is a no-op
    pathResolutionManager.setSessionId('test-session')
  })

  it('returns empty object for empty candidates', () => {
    const { result } = renderHook(() => usePathResolution([]))
    expect(result.current).toEqual({})
  })

  it('resolves candidates via API', async () => {
    mockResolvePaths.mockResolvedValue({ 'src/app.js': '/abs/src/app.js' })

    const { result } = renderHook(() => usePathResolution(['src/app.js']))

    await waitFor(() => {
      expect(result.current).toEqual({ 'src/app.js': '/abs/src/app.js' })
    })
    expect(mockResolvePaths).toHaveBeenCalledWith(['src/app.js'])
  })

  it('uses cache for already-resolved paths', async () => {
    pathResolutionManager.store(['a.py'], { 'a.py': '/abs/a.py' })

    const { result } = renderHook(() => usePathResolution(['a.py']))

    await waitFor(() => {
      expect(result.current).toEqual({ 'a.py': '/abs/a.py' })
    })
    expect(mockResolvePaths).not.toHaveBeenCalled()
  })

  it('handles API error gracefully', async () => {
    mockResolvePaths.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => usePathResolution(['bad.py']))

    // Should not throw - graceful degradation
    await waitFor(() => {
      expect(result.current).toEqual({})
    })
  })

  it('only calls API for uncached candidates', async () => {
    pathResolutionManager.store(['a.py'], { 'a.py': '/abs/a.py' })
    mockResolvePaths.mockResolvedValue({ 'b.js': '/abs/b.js' })

    const { result } = renderHook(() => usePathResolution(['a.py', 'b.js']))

    await waitFor(() => {
      expect(result.current).toEqual({ 'a.py': '/abs/a.py', 'b.js': '/abs/b.js' })
    })
    expect(mockResolvePaths).toHaveBeenCalledWith(['b.js'])
  })
})
