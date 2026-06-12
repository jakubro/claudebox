/** Batch path resolution with session-scoped caching. */

import { resolvePaths } from '../api/pathResolution'
import { PATH_RESOLVE_BATCH_MS } from '../config/timing'

export default class PathResolutionManager {
  /**
   * Batch concurrent enqueue calls into a single API request and maintain
   * a session-scoped cache of resolved paths.
   *
   * Multiple usePathResolution hooks fire simultaneously during render.
   * Each enqueue call adds candidates to a pending set. After a short delay,
   * all pending candidates are flushed in one resolvePaths API call and results
   * are distributed back to each caller's promise.
   */
  constructor() {
    /** @type {Map<string, Set<{resolve: Function, reject: Function}>>} */
    this._pending = new Map()
    this._flushScheduled = false
    this._timerId = null

    /** @type {Map<string, string|null>} candidate -> resolved path or null */
    this._cache = new Map()
    /** @type {string|null} */
    this._sessionId = null
  }

  /** Clear pending and cache state. Used in tests to prevent cross-test leakage. */
  reset() {
    if (this._timerId != null) {
      clearTimeout(this._timerId)
    }
    this._pending = new Map()
    this._flushScheduled = false
    this._timerId = null
    this._cache = new Map()
    this._sessionId = null
  }

  /** Clear the resolution cache. */
  clearCache() {
    this._cache = new Map()
  }

  /**
   * Set session ID; clears cache if it changed.
   * @param {string} sessionId
   */
  setSessionId(sessionId) {
    if (sessionId !== this._sessionId) {
      this._sessionId = sessionId
      this.clearCache()
    }
  }

  /**
   * Look up candidates against the cache.
   * @param {string[]} candidates
   * @returns {{ resolved: Object<string, string>, unresolved: string[] }}
   */
  lookup(candidates) {
    const resolved = {}
    const unresolved = []

    for (const c of candidates) {
      if (this._cache.has(c)) {
        const val = this._cache.get(c)
        if (val !== null) {
          resolved[c] = val
        }
        // null means confirmed non-existent - skip (don't re-request)
      } else {
        unresolved.push(c)
      }
    }

    return { resolved, unresolved }
  }

  /**
   * Store resolution results. Candidates not in resolvedMap are stored as null.
   * @param {string[]} allRequested - All candidates that were sent to the API.
   * @param {Object<string, string>} resolvedMap - Map of candidate -> absolute path.
   */
  store(allRequested, resolvedMap) {
    for (const c of allRequested) {
      this._cache.set(c, resolvedMap[c] ?? null)
    }
  }

  /**
   * Enqueue candidates for batched resolution.
   * @param {string[]} candidates - Path candidates to resolve.
   * @returns {Promise<Object<string, string>>} Resolved map for the requested candidates.
   */
  enqueue(candidates) {
    if (!candidates || candidates.length === 0) {
      return Promise.resolve({})
    }

    return new Promise((resolve, reject) => {
      const caller = { resolve, reject }

      for (const candidate of candidates) {
        if (!this._pending.has(candidate)) {
          this._pending.set(candidate, new Set())
        }
        this._pending.get(candidate).add(caller)
      }

      if (!this._flushScheduled) {
        this._flushScheduled = true
        this._timerId = setTimeout(() => this._flush(), PATH_RESOLVE_BATCH_MS)
      }
    })
  }

  /** Flush all pending candidates in a single API call. */
  async _flush() {
    const batch = this._pending
    this._pending = new Map()
    this._flushScheduled = false

    const allCandidates = [...batch.keys()]

    // Collect unique callers across all candidates
    const allCallers = new Set()
    for (const callers of batch.values()) {
      for (const caller of callers) {
        allCallers.add(caller)
      }
    }

    try {
      const resolvedMap = await resolvePaths(allCandidates)

      for (const caller of allCallers) {
        caller.resolve(resolvedMap)
      }
    } catch (err) {
      for (const caller of allCallers) {
        caller.reject(err)
      }
    }
  }
}

/** Singleton instance shared across all hook consumers. */
export const pathResolutionManager = new PathResolutionManager()
