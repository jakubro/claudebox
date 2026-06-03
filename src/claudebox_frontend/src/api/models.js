/** Models API client — container-proxied endpoints. */

import { containerFetch } from './apiClient'

/** Set the active model for the current session. */
export async function setModel(model) {
  await containerFetch('/api/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
}
