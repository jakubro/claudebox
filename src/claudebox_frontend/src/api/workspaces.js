/** Workspace API client — workspace-level metadata endpoints. */

import { workspaceFetch } from './apiClient'

/** Fetch the model / permission mode / effort level a new session in this workspace would inherit. */
export async function getSessionDefaults() {
  const res = await workspaceFetch('/session-defaults')
  if (!res.ok) {
    throw new Error('Failed to fetch session defaults')
  }
  return res.json()
}

/** Fetch the workspace's filesystem-discovered slash commands.
 *
 * Result shape mirrors the in-session `commands` field — `{custom, mcp, builtin}` —
 * so SessionDataContext consumers do not branch on origin.
 */
export async function getCommandCatalog() {
  const res = await workspaceFetch('/commands')
  if (!res.ok) {
    throw new Error('Failed to fetch command catalog')
  }
  return res.json()
}

/** Register a workspace at the given absolute path.
 *
 * Idempotent — re-registering an already-known path returns the existing entry with 200.
 */
export async function registerWorkspace(path) {
  const res = await fetch('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Failed to register workspace (${res.status})`)
  }
  return res.json()
}

/** Deregister a workspace by id.
 *
 * Returns 404 with `error_key: "workspace_not_registered"` if the workspace was
 * never registered. The `.workspace` marker file on disk is preserved — only the
 * daemon-side registry entry is removed.
 */
export async function deregisterWorkspace(id) {
  const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Failed to deregister workspace ${id} (${res.status})`)
  }
  return res.json()
}
