/** Sessions API client - workspace-scoped and container-scoped endpoints. */

import {
  FETCH_TIMEOUT_INTERACTIVE_MS,
  FETCH_TIMEOUT_LISTING_MS,
  FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
} from '../config/timing'
import { containerFetch, containerUrl, retryFetch, workspaceFetch } from './apiClient'

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
 * Fetch sessions for an explicit workspace id, bypassing the active-workspace singleton; used by cross-workspace
 * dead-session storage GC, which must see every workspace's sessions regardless of which is active.
 */
export async function listSessionsForWorkspace(workspaceId) {
  const res = await retryFetch(`/api/workspaces/${workspaceId}/sessions`, {
    timeoutMs: FETCH_TIMEOUT_LISTING_MS,
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch sessions for workspace ${workspaceId}`)
  }
  return res.json()
}

/**
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {string[]} [options.messages] - Messages to submit as the session's first turns.
 * @returns {Promise<{session_id: string, container_id: string, undelivered_messages?: string[]}>}
 */
export async function newSession({ signal, messages } = {}) {
  const hasMessages = messages?.length > 0
  const res = await workspaceFetch('/sessions/new', {
    method: 'POST',
    signal,
    timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
    ...(hasMessages && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }),
  })
  if (!res.ok) {
    throw new Error('Failed to start new session')
  }
  return res.json()
}

/**
 * Update session metadata (e.g., rename).
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
 * @param {string} sessionId
 * @returns {Promise<{session_id: string, container_id: string}>}
 */
export async function resumeSession(sessionId) {
  const res = await workspaceFetch(`/sessions/${sessionId}/resume`, {
    method: 'POST',
    timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
  })
  if (!res.ok) {
    throw new Error('Failed to resume session')
  }
  return res.json()
}

/**
 * @param {string} sessionId
 * @param {string|null} [turnId] - Turn to fork from, or null/omitted for complete session fork.
 * @param {Object} [options]
 * @param {boolean} [options.reuse_container] - Reuse source session's container instead of spawning new.
 * @param {boolean} [options.share_container] - Join the source's container as a member; mutually
 *   exclusive with reuse_container.
 * @param {string} [options.parent_session_id] - Override the recorded parent (default: sessionId).
 * @returns {Promise<{session_id: string, container_id: string}>} New session info.
 */
export async function forkSession(
  sessionId,
  turnId,
  { reuse_container, share_container, parent_session_id } = {},
) {
  const payload = {}
  if (turnId) {
    payload.turn_id = turnId
  }
  if (reuse_container) {
    payload.reuse_container = true
  }
  if (share_container) {
    payload.share_container = true
  }
  if (parent_session_id) {
    payload.parent_session_id = parent_session_id
  }
  const res = await workspaceFetch(`/sessions/${sessionId}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
  })
  if (!res.ok) {
    throw new Error('Failed to fork session')
  }
  return res.json()
}

// Container-scoped (proxied) endpoints

/** Fetch the current session state from the container. */
export async function getSession() {
  const res = await containerFetch('/api/sessions/current', {
    timeoutMs: FETCH_TIMEOUT_INTERACTIVE_MS,
  })
  if (!res.ok) {
    throw new Error(`Status fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Read a session's persisted events without starting anything - what a stopped side thread's
 * float re-renders from, since the SSE stream requires a live session to attach to.
 * @param {string} sessionId
 * @returns {Promise<{events: Array, running: boolean}>}
 */
export async function getSessionEvents(sessionId) {
  // Action tier, not interactive: one-shot, and the payload grows with the thread's whole log.
  const res = await containerFetch(`/api/sessions/${sessionId}/events`)
  if (!res.ok) {
    throw new Error('Failed to fetch session events')
  }
  return res.json()
}

/**
 * Stop one non-primary session and remove it from the registry - idempotent if already gone.
 * Promotion calls this before forking so the copy never races a still-writing transcript.
 * @param {string} sessionId
 */
export async function stopSession(sessionId) {
  const res = await containerFetch(`/api/sessions/${sessionId}/stop`, { method: 'POST' })
  if (!res.ok) {
    throw new Error('Failed to stop session')
  }
}

/**
 * Cancel a member session's turn-complete auto-stop - it runs until stopped like any other.
 * Touches only whether the session outlives its next answer, never its identity.
 * @param {string} sessionId
 */
export async function promoteSession(sessionId) {
  const res = await containerFetch(`/api/sessions/${sessionId}/promote`, { method: 'POST' })
  if (!res.ok) {
    throw new Error('Failed to promote session')
  }
}

/** Fetch full tool output for a tool use block. */
export async function getToolOutput(toolUseId) {
  // Action tier for the same reason as the event log: one-shot, and a shorter bound would fire
  // before the daemon's own proxy read could turn a slow container into a typed error.
  const res = await containerFetch(`/api/sessions/current/tool-output/${toolUseId}`)
  if (!res.ok) {
    throw new Error('Failed to fetch tool output')
  }
  return res.json()
}

/** @param {string|null} sessionPrompt - Prompt text, or null to clear. */
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
