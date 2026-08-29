/** Workspace API client - workspace-level metadata endpoints. */

import { FETCH_TIMEOUT_INTERACTIVE_MS, FETCH_TIMEOUT_LISTING_MS } from '../config/timing'
import { retryFetch, workspaceFetch } from './apiClient'

/** Fetch the registered-workspace list from the daemon. */
export async function listWorkspaces() {
  const res = await retryFetch('/api/workspaces', { timeoutMs: FETCH_TIMEOUT_LISTING_MS })
  if (!res.ok) {
    throw new Error('Failed to fetch workspaces')
  }
  const data = await res.json()
  return data.workspaces || []
}

/** Fetch the model / permission mode / effort level a new session in this workspace would inherit. */
export async function getSessionDefaults() {
  const res = await workspaceFetch('/session-defaults', {
    timeoutMs: FETCH_TIMEOUT_INTERACTIVE_MS,
  })
  if (!res.ok) {
    throw new Error('Failed to fetch session defaults')
  }
  return res.json()
}

/** Fetch the workspace's filesystem-discovered slash commands; result shape mirrors the in-session `commands` field (`{custom, mcp, builtin}`) so SessionDataContext consumers do not branch on origin. */
export async function getCommandCatalog() {
  // Listing tier, not interactive: this fires once per workspace, so there is no next poll to
  // recover, and the daemon serves it with an unbounded filesystem scan.
  const res = await workspaceFetch('/commands')
  if (!res.ok) {
    throw new Error('Failed to fetch command catalog')
  }
  return res.json()
}

/** Register a workspace at the given absolute path; idempotent - re-registering an already-known path returns the existing entry with 200. */
export async function registerWorkspace(path) {
  const res = await retryFetch('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    timeoutMs: FETCH_TIMEOUT_LISTING_MS,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Failed to register workspace (${res.status})`)
  }
  return res.json()
}

/** Deregister a workspace by id; returns 404 with `error_key: "workspace_not_registered"` if never registered. The `.workspace` marker file on disk is preserved - only the daemon-side registry entry is removed. */
export async function deregisterWorkspace(id) {
  const res = await retryFetch(`/api/workspaces/${id}`, {
    method: 'DELETE',
    timeoutMs: FETCH_TIMEOUT_LISTING_MS,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Failed to deregister workspace ${id} (${res.status})`)
  }
  return res.json()
}
