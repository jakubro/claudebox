/** Containers API client — workspace-scoped endpoints only. */

import { workspaceFetch } from './apiClient'

/** Delete (stop and remove) a container in the current workspace. */
export async function deleteContainer(containerId) {
  const res = await workspaceFetch(`/containers/${containerId}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error('Failed to delete container')
  }
  return res.json()
}

/** List containers registered to the current workspace. */
export async function listContainers() {
  const res = await workspaceFetch('/containers')
  if (!res.ok) {
    throw new Error(`Failed to list containers: ${res.status}`)
  }
  return res.json()
}
