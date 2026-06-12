/** Path resolution API client - resolve candidates to absolute host paths. */

import { containerFetch } from './apiClient'

/**
 * Resolve path candidates to absolute host paths via container API.
 * @param {string[]} candidates - Array of path candidate strings.
 * @returns {Promise<Object<string, string>>} Map of candidate -> resolved absolute path.
 */
export async function resolvePaths(candidates) {
  const res = await containerFetch('/api/files/resolve-paths', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidates }),
  })
  if (!res.ok) {
    throw new Error('Failed to resolve paths')
  }
  const data = await res.json()
  return data.resolved
}
