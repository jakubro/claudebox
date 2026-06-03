/** Permission modes API client — container-proxied endpoints. */

import { containerFetch } from './apiClient'

/** Set the active permission mode for the current session. */
export async function setPermissionMode(permissionMode) {
  await containerFetch('/api/permission-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permission_mode: permissionMode }),
  })
}
