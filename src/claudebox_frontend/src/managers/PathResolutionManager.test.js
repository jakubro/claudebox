/** Tests for PathResolutionManager batching and caching logic. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PathResolutionManager from './PathResolutionManager'

const mockResolvePaths = vi.fn()

vi.mock('../api/pathResolution', () => ({
  resolvePaths: (...args) => mockResolvePaths(...args),
}))

describe('PathResolutionManager', () => {
  let manager

  beforeEach(() => {
    vi.useFakeTimers()
    mockResolvePaths.mockReset()
    manager = new PathResolutionManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty object for empty candidates', async () => {
    const result = await manager.enqueue([])
    expect(result).toEqual({})
    expect(mockResolvePaths).not.toHaveBeenCalled()
  })

  it('resolves a single enqueue call', async () => {
    mockResolvePaths.mockResolvedValue({ 'src/app.js': '/abs/src/app.js' })

    const promise = manager.enqueue(['src/app.js'])
    vi.advanceTimersByTime(10)
    const result = await promise

    expect(result).toEqual({ 'src/app.js': '/abs/src/app.js' })
    expect(mockResolvePaths).toHaveBeenCalledWith(['src/app.js'])
  })

  it('batches concurrent enqueue calls into a single API request', async () => {
    mockResolvePaths.mockResolvedValue({
      'src/app.js': '/abs/src/app.js',
      'lib/utils.py': '/abs/lib/utils.py',
      'config.toml': '/abs/config.toml',
    })

    // Simulate three hooks enqueueing within the batch window
    const p1 = manager.enqueue(['src/app.js'])
    const p2 = manager.enqueue(['lib/utils.py'])
    const p3 = manager.enqueue(['config.toml'])

    vi.advanceTimersByTime(10)
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    // All callers receive the full resolved map
    expect(r1).toEqual(r2)
    expect(r2).toEqual(r3)

    // Only one API call was made
    expect(mockResolvePaths).toHaveBeenCalledTimes(1)
    expect(mockResolvePaths).toHaveBeenCalledWith(
      expect.arrayContaining(['src/app.js', 'lib/utils.py', 'config.toml']),
    )
  })

  it('deduplicates overlapping candidates across callers', async () => {
    mockResolvePaths.mockResolvedValue({ 'src/app.js': '/abs/src/app.js' })

    const p1 = manager.enqueue(['src/app.js'])
    const p2 = manager.enqueue(['src/app.js'])

    vi.advanceTimersByTime(10)
    await Promise.all([p1, p2])

    // Candidate appears once in the API call
    expect(mockResolvePaths).toHaveBeenCalledTimes(1)
    const candidates = mockResolvePaths.mock.calls[0][0]
    expect(candidates.filter(c => c === 'src/app.js')).toHaveLength(1)
  })

  it('propagates API errors to all callers', async () => {
    mockResolvePaths.mockRejectedValue(new Error('Network error'))

    const p1 = manager.enqueue(['a.py'])
    const p2 = manager.enqueue(['b.js'])

    vi.advanceTimersByTime(10)

    await expect(p1).rejects.toThrow('Network error')
    await expect(p2).rejects.toThrow('Network error')
  })

  it('starts a new batch after flush', async () => {
    mockResolvePaths.mockResolvedValueOnce({ 'a.py': '/abs/a.py' })
    mockResolvePaths.mockResolvedValueOnce({ 'b.js': '/abs/b.js' })

    // First batch
    const p1 = manager.enqueue(['a.py'])
    vi.advanceTimersByTime(10)
    const r1 = await p1
    expect(r1).toEqual({ 'a.py': '/abs/a.py' })

    // Second batch (after first flush completes)
    const p2 = manager.enqueue(['b.js'])
    vi.advanceTimersByTime(10)
    const r2 = await p2
    expect(r2).toEqual({ 'b.js': '/abs/b.js' })

    expect(mockResolvePaths).toHaveBeenCalledTimes(2)
  })
})

describe('PathResolutionManager cache', () => {
  let manager

  beforeEach(() => {
    manager = new PathResolutionManager()
  })

  it('returns all candidates as unresolved on empty cache', () => {
    const result = manager.lookup(['a.py', 'b.js'])
    expect(result.resolved).toEqual({})
    expect(result.unresolved).toEqual(['a.py', 'b.js'])
  })

  it('returns cached resolved paths as hits', () => {
    manager.store(['a.py', 'b.js'], { 'a.py': '/abs/a.py' })

    const result = manager.lookup(['a.py', 'b.js'])
    expect(result.resolved).toEqual({ 'a.py': '/abs/a.py' })
    expect(result.unresolved).toEqual([])
  })

  it('stores null for non-existent candidates', () => {
    manager.store(['a.py', 'b.js'], { 'a.py': '/abs/a.py' })

    // b.js stored as null — should not appear in resolved or unresolved
    const result = manager.lookup(['b.js'])
    expect(result.resolved).toEqual({})
    expect(result.unresolved).toEqual([])
  })

  it('clears cache on clearCache()', () => {
    manager.store(['a.py'], { 'a.py': '/abs/a.py' })
    manager.clearCache()

    const result = manager.lookup(['a.py'])
    expect(result.unresolved).toEqual(['a.py'])
  })

  it('clears cache when session ID changes', () => {
    manager.setSessionId('session-1')
    manager.store(['a.py'], { 'a.py': '/abs/a.py' })

    manager.setSessionId('session-2')

    const result = manager.lookup(['a.py'])
    expect(result.unresolved).toEqual(['a.py'])
  })

  it('does not clear cache when session ID stays the same', () => {
    manager.setSessionId('session-1')
    manager.store(['a.py'], { 'a.py': '/abs/a.py' })

    manager.setSessionId('session-1')

    const result = manager.lookup(['a.py'])
    expect(result.resolved).toEqual({ 'a.py': '/abs/a.py' })
  })
})
