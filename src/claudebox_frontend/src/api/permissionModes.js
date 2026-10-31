/** Permission modes API client - container-proxied endpoints. */

import { containerFetch, sessionPath } from './apiClient'

/** Set the active permission mode for `target`, else the addressed session; throws if it is not applied. */
export async function setPermissionMode(permissionMode, target = {}) {
  const res = await containerFetch(
    sessionPath('/api/permission-mode', target.sessionId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission_mode: permissionMode }),
    },
    target.containerId,
  )
  if (!res.ok) {
    throw new Error('Failed to apply permission mode')
  }
}
