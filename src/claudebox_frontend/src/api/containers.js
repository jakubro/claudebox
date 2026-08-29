/** Containers API client - workspace-scoped endpoints only. */

import {
  FETCH_TIMEOUT_CONTAINER_LIFECYCLE_MS,
  FETCH_TIMEOUT_INTERACTIVE_MS,
} from '../config/timing'
import { workspaceFetch } from './apiClient'

/** Fetch one container's registry entry; null when it is not registered. */
export async function getContainer(containerId, { signal } = {}) {
  const res = await workspaceFetch(`/containers/${containerId}`, {
    signal,
    timeoutMs: FETCH_TIMEOUT_INTERACTIVE_MS,
  })

  return res.ok ? res.json() : null
}

/** Delete (stop and remove) a container in the current workspace. */
export async function deleteContainer(containerId) {
  const res = await workspaceFetch(`/containers/${containerId}`, {
    method: 'DELETE',
    timeoutMs: FETCH_TIMEOUT_CONTAINER_LIFECYCLE_MS,
  })
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
