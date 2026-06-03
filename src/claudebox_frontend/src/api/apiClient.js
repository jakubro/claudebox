/** Workspace-aware and container-aware fetch wrappers for daemon API calls. */

import {
  FETCH_RETRY_BASE_DELAY_MS,
  FETCH_RETRY_MAX_ATTEMPTS,
  FETCH_RETRY_MAX_DELAY_MS,
} from '../config/timing'

let _workspaceId = null
let _containerId = null

/** Set the active workspace ID. Called by WorkspaceContext on discovery. */
export function setWorkspaceId(id) {
  _workspaceId = id
}

/** Get current workspace ID. */
export function getWorkspaceId() {
  return _workspaceId
}

/** Set the active container ID. Called after session new/resume returns container_id. */
export function setContainerId(id) {
  _containerId = id
}

/** Get current container ID. */
export function getContainerId() {
  return _containerId
}

/**
 * Fetch with automatic retry for transient errors (network failures, cert expiry, gateway errors).
 * Retries with exponential backoff. Non-retryable errors propagate immediately.
 * @param {string} url - Request URL.
 * @param {RequestInit} [options] - Standard fetch options.
 * @returns {Promise<Response>}
 */
export async function retryFetch(url, options) {
  let lastResponse

  for (let attempt = 0; attempt <= FETCH_RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(
        FETCH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        FETCH_RETRY_MAX_DELAY_MS,
      )
      await new Promise(r => setTimeout(r, delay))
    }

    try {
      const response = await fetch(url, options)
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

  // All retries exhausted with retryable HTTP status — return the last response
  return lastResponse
}

/**
 * Fetch with workspace prefix.
 * @param {string} path - Relative path (e.g., '/sessions').
 * @param {RequestInit} options - Standard fetch options.
 * @returns {Promise<Response>}
 */
export function workspaceFetch(path, options) {
  if (!_workspaceId) {
    throw new Error('Workspace ID not set')
  }
  return retryFetch(`/api/workspaces/${_workspaceId}${path}`, options)
}

/**
 * Fetch routed through the daemon's container proxy.
 * @param {string} path - Path including /api prefix (e.g., '/api/send').
 * @param {RequestInit} options - Standard fetch options.
 * @returns {Promise<Response>}
 */
export function containerFetch(path, options) {
  if (!_workspaceId) {
    throw new Error('Workspace ID not set')
  }
  if (!_containerId) {
    throw new Error('Container ID not set')
  }
  return retryFetch(`/api/workspaces/${_workspaceId}/containers/${_containerId}${path}`, options)
}

/**
 * Build a container-proxied URL (for EventSource construction).
 * @param {string} path - Path including /api prefix (e.g., '/api/stream').
 * @returns {string}
 */
export function containerUrl(path) {
  if (!_workspaceId) {
    throw new Error('Workspace ID not set')
  }
  if (!_containerId) {
    throw new Error('Container ID not set')
  }
  return `/api/workspaces/${_workspaceId}/containers/${_containerId}${path}`
}

/**
 * Determine whether a failed fetch should be retried.
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
