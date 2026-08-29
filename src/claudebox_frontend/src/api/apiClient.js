/** Workspace-aware and container-aware fetch wrappers for daemon API calls. */

import {
  FETCH_RETRY_BASE_DELAY_MS,
  FETCH_RETRY_MAX_ATTEMPTS,
  FETCH_RETRY_MAX_DELAY_MS,
  FETCH_TIMEOUT_ACTION_MS,
  FETCH_TIMEOUT_LISTING_MS,
} from '../config/timing'

let _workspaceId = null
let _containerId = null

/** Called by WorkspaceContext on discovery. */
export function setWorkspaceId(id) {
  _workspaceId = id
}

export function getWorkspaceId() {
  return _workspaceId
}

/** Called after session new/resume returns container_id. */
export function setContainerId(id) {
  _containerId = id
}

export function getContainerId() {
  return _containerId
}

/**
 * Fetch with automatic retry for transient errors (network failures, cert expiry, gateway errors);
 * retries with exponential backoff; non-retryable errors propagate immediately.
 * Each attempt is bounded by `timeoutMs`, and an expired bound is not retryable - an unanswered
 * request surfaces as an error instead of holding a connection slot for the life of the page.
 * @param {string} url - Request URL.
 * @param {RequestInit & {timeoutMs?: number}} [options] - Fetch options plus the attempt bound.
 * @returns {Promise<Response>}
 */
export async function retryFetch(url, options) {
  const { timeoutMs = FETCH_TIMEOUT_ACTION_MS, signal, ...init } = options || {}
  let lastResponse

  for (let attempt = 0; attempt <= FETCH_RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(
        FETCH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        FETCH_RETRY_MAX_DELAY_MS,
      )
      await new Promise(r => setTimeout(r, delay))
    }

    // Minted per attempt, so a retry gets the whole bound rather than the remainder.
    const bound = AbortSignal.timeout(timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, bound]) : bound,
      })
      if (isRetryable(null, response) && attempt < FETCH_RETRY_MAX_ATTEMPTS) {
        lastResponse = response
        continue
      }
      return response
    } catch (error) {
      if (!isRetryable(error) || attempt >= FETCH_RETRY_MAX_ATTEMPTS) {
        throw error
      }
    }
  }

  // All retries exhausted with retryable HTTP status - return the last response
  return lastResponse
}

/**
 * Daemon-local calls, bounded above DISK_LISTING_TIMEOUT by default so a listing's typed error
 * arrives instead of a client abort. Slower classes pass their own `timeoutMs`.
 * @param {string} path - Relative path (e.g., '/sessions').
 * @param {RequestInit & {timeoutMs?: number}} [options] - Standard fetch options.
 * @returns {Promise<Response>}
 */
export function workspaceFetch(path, options) {
  if (!_workspaceId) {
    throw new Error('Workspace ID not set')
  }
  return retryFetch(`/api/workspaces/${_workspaceId}${path}`, {
    timeoutMs: FETCH_TIMEOUT_LISTING_MS,
    ...options,
  })
}

/**
 * Container-proxied calls. The default clears one stale-port refresh and retry, so a one-shot
 * action survives a container that moved; repeated reads pass a shorter `timeoutMs`.
 * @param {string} path - Path including /api prefix (e.g., '/api/send').
 * @param {RequestInit & {timeoutMs?: number}} [options] - Standard fetch options.
 * @param {string} [containerId] - Explicit container to address; defaults to the module-level one.
 * @returns {Promise<Response>}
 */
export function containerFetch(path, options, containerId = _containerId) {
  if (!_workspaceId) {
    throw new Error('Workspace ID not set')
  }
  if (!containerId) {
    throw new Error('Container ID not set')
  }
  return retryFetch(`/api/workspaces/${_workspaceId}/containers/${containerId}${path}`, {
    timeoutMs: FETCH_TIMEOUT_ACTION_MS,
    ...options,
  })
}

/**
 * Build a container-proxied URL (for EventSource construction).
 * @param {string} path - Path including /api prefix (e.g., '/api/stream').
 * @param {string} [containerId] - Explicit container to address; defaults to the module-level one.
 * @returns {string}
 */
export function containerUrl(path, containerId = _containerId) {
  if (!_workspaceId) {
    throw new Error('Workspace ID not set')
  }
  if (!containerId) {
    throw new Error('Container ID not set')
  }
  return `/api/workspaces/${_workspaceId}/containers/${containerId}${path}`
}

/**
 * @param {Error} error - The caught error (TypeError for network failures).
 * @param {Response} [response] - The HTTP response, if the request completed.
 * @returns {boolean}
 */
function isRetryable(error, response) {
  if (error instanceof TypeError) {
    return true
  }
  if (response && [502, 503, 504].includes(response.status)) {
    return true
  }
  return false
}
