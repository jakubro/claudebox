/** Sessions API client — workspace-scoped and container-scoped endpoints. */

import { containerFetch, containerUrl, workspaceFetch } from './apiClient'

// Workspace-scoped (daemon) endpoints

/** Fetch all available sessions from the daemon. */
export async function listSessions() {
  const res = await workspaceFetch('/sessions')
  if (!res.ok) {
    throw new Error('Failed to fetch sessions')
  }
  return res.json()
}

/**
 * Create a new session via the daemon.
 * @returns {Promise<{session_id: string, container_id: string}>}
 */
export async function newSession({ signal } = {}) {
  const res = await workspaceFetch('/sessions/new', { method: 'POST', signal })
  if (!res.ok) {
    throw new Error('Failed to start new session')
  }
  return res.json()
}

/**
 * Update session metadata (e.g., rename) via the daemon.
 * @param {string} sessionId
 * @param {Object} data - Fields to update.
 */
export async function updateSession(sessionId, data) {
  const res = await workspaceFetch(`/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    throw new Error('Failed to rename session')
  }
}

/**
 * Resume a previous session via the daemon.
 * @param {string} sessionId
 * @returns {Promise<{session_id: string, container_id: string}>}
 */
export async function resumeSession(sessionId) {
  const res = await workspaceFetch(`/sessions/${sessionId}/resume`, { method: 'POST' })
  if (!res.ok) {
    throw new Error('Failed to resume session')
  }
  return res.json()
}

/**
 * Fork a session via the daemon, optionally from a specific turn.
 * @param {string} sessionId
 * @param {string|null} [turnId] - Turn to fork from, or null/omitted for complete session fork.
 * @param {Object} [options]
 * @param {boolean} [options.reuse_container] - Reuse source session's container instead of spawning new.
 * @returns {Promise<{session_id: string, container_id: string}>} New session info.
 */
export async function forkSession(sessionId, turnId, { reuse_container } = {}) {
  const payload = {}
  if (turnId) {
    payload.turn_id = turnId
  }
  if (reuse_container) {
    payload.reuse_container = true
  }
  const res = await workspaceFetch(`/sessions/${sessionId}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error('Failed to fork session')
  }
  return res.json()
}

// Container-scoped (proxied) endpoints

/** Fetch the current session state from the container. */
export async function getSession() {
  const res = await containerFetch('/api/sessions/current')
  if (!res.ok) {
    throw new Error(`Status fetch failed: ${res.status}`)
  }
  return res.json()
}

/** Fetch full tool output for a tool use block. */
export async function getToolOutput(toolUseId) {
  const res = await containerFetch(`/api/sessions/current/tool-output/${toolUseId}`)
  if (!res.ok) {
    throw new Error('Failed to fetch tool output')
  }
  return res.json()
}

/**
 * Update the session prompt text.
 * @param {string|null} sessionPrompt - Prompt text, or null to clear.
 */
export async function updateSessionPrompt(sessionPrompt) {
  const res = await containerFetch('/api/sessions/current/prompt', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_prompt: sessionPrompt }),
  })
  if (!res.ok) {
    throw new Error('Failed to update session prompt')
  }
}

/** Build download URL for tool output (container-proxied). */
export function getToolOutputDownloadUrl(toolUseId) {
  return containerUrl(`/api/sessions/current/tool-output/${toolUseId}/download`)
}
