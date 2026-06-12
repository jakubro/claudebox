/** Effort levels API client - container-proxied endpoints. */

import { containerFetch } from './apiClient'

/** Set the active effort level for the current session. */
export async function setEffortLevel(effortLevel) {
  await containerFetch('/api/effort-level', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effort_level: effortLevel }),
  })
}
