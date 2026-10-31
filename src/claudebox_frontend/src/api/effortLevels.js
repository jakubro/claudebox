/** Effort levels API client - container-proxied endpoints. */

import { containerFetch, sessionPath } from './apiClient'

/** Set the active effort level for `target`, else the addressed session; throws if it is not applied. */
export async function setEffortLevel(effortLevel, target = {}) {
  const res = await containerFetch(
    sessionPath('/api/effort-level', target.sessionId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effort_level: effortLevel }),
    },
    target.containerId,
  )
  if (!res.ok) {
    throw new Error('Failed to apply effort level')
  }
}
