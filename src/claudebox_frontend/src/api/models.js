/** Models API client - container-proxied endpoints. */

import { containerFetch, sessionPath } from './apiClient'

/** Set the active model for `target`, else the addressed session; throws if it is not applied. */
export async function setModel(model, target = {}) {
  const res = await containerFetch(
    sessionPath('/api/model', target.sessionId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    },
    target.containerId,
  )
  if (!res.ok) {
    throw new Error('Failed to apply model')
  }
}
