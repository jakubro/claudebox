/** UI state API for global and session-scoped preferences via daemon. */

import { workspaceFetch } from './apiClient'

/**
 * Fetch UI state (global and optionally session-scoped).
 * @param {string|null} sessionId - Include session state if provided.
 */
export async function getUiState(sessionId = null) {
  const url = getUrl(sessionId)
  const res = await workspaceFetch(url)
  if (!res.ok) {
    throw new Error('Failed to fetch ui-state')
  }
  return res.json()
}

/** Apply operations to global UI state. */
export function patchGlobalUiState(operations) {
  patchUiState(null, { global: operations })
}

/** Apply operations to session-scoped UI state. */
export function patchSessionUiState(sessionId, operations) {
  patchUiState(sessionId, { session: operations })
}

/**
 * Apply operations to UI state (fire-and-forget).
 * @param {string|null} sessionId
 * @param {Object} data - Operations per scope ({ global, session }).
 */
export function patchUiState(sessionId, data) {
  const url = getUrl(sessionId)
  workspaceFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(err => {
    // Intentional: persistence is best-effort
    console.warn('uiState: patch failed', err)
  })
}

function getUrl(sessionId) {
  const basePath = '/ui-state'
  return sessionId ? `${basePath}?session_id=${sessionId}` : basePath
}
