/** Board API client — workspace-scoped board CRUD operations. */

import { workspaceFetch } from './apiClient'

/** List all discovered boards in the workspace. */
export async function listBoards() {
  const res = await workspaceFetch('/boards')
  if (!res.ok) {
    throw new Error('Failed to fetch boards')
  }
  return res.json()
}

/** Get full board state with resolved ticket titles. */
export async function getBoard(boardId) {
  const res = await workspaceFetch(`/boards/${boardId}`)
  if (!res.ok) {
    throw new Error('Failed to fetch board')
  }
  return res.json()
}

/** Rename a board by setting its name: field. */
export async function renameBoard(boardId, name) {
  const res = await workspaceFetch(`/boards/${boardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw new Error('Failed to rename board')
  }
  return res.json()
}

/** Get raw markdown content of a ticket file. */
export async function getTicketContent(boardId, ticketPath) {
  const res = await workspaceFetch(
    `/boards/${boardId}/tickets/${encodeURIComponent(ticketPath)}/content`,
  )
  if (!res.ok) {
    throw new Error('Failed to fetch ticket content')
  }
  return res.text()
}

/** Move a ticket between columns and/or swimlanes, optionally at a specific index. */
export async function moveTicket(boardId, ticketPath, { column, swimlane, index } = {}) {
  const body = { column, swimlane }
  if (index !== undefined) {
    body.index = index
  }
  const res = await workspaceFetch(
    `/boards/${boardId}/tickets/${encodeURIComponent(ticketPath)}/move`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    throw new Error('Failed to move ticket')
  }
  return res.json()
}

/** Archive a ticket — remove from YAML, file stays on disk. */
export async function archiveTicket(boardId, ticketPath) {
  const res = await workspaceFetch(`/boards/${boardId}/tickets/${encodeURIComponent(ticketPath)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error('Failed to archive ticket')
  }
}

/** Batch assign tickets to new sessions. */
export async function assignTickets(boardId, tickets, { parallel = true } = {}) {
  const res = await workspaceFetch(`/boards/${boardId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickets, parallel }),
  })
  if (!res.ok) {
    throw new Error('Failed to assign tickets')
  }
  return res.json()
}

/** Create a new swimlane. */
export async function createSwimlane(boardId, name) {
  const res = await workspaceFetch(`/boards/${boardId}/swimlanes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw new Error('Failed to create swimlane')
  }
  return res.json()
}

/** Rename an existing swimlane. */
export async function renameSwimlane(boardId, swimlaneId, name) {
  const res = await workspaceFetch(`/boards/${boardId}/swimlanes/${swimlaneId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw new Error('Failed to rename swimlane')
  }
  return res.json()
}

/** Delete a swimlane. Tickets in it become unsorted. */
export async function deleteSwimlane(boardId, swimlaneId) {
  const res = await workspaceFetch(`/boards/${boardId}/swimlanes/${swimlaneId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error('Failed to delete swimlane')
  }
}

/** Rename a column/state's display label. Folder and ID stay unchanged. */
export async function renameState(boardId, stateId, label) {
  const res = await workspaceFetch(`/boards/${boardId}/states/${stateId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  if (!res.ok) {
    throw new Error('Failed to rename state')
  }
  return res.json()
}

/** Reorder columns/states to match the given key order. */
export async function reorderStates(boardId, keys) {
  const res = await workspaceFetch(`/boards/${boardId}/states/reorder`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  })
  if (!res.ok) {
    throw new Error('Failed to reorder states')
  }
  return res.json()
}

/** Reorder swimlanes to match the given ID order. */
export async function reorderSwimlanes(boardId, ids) {
  const res = await workspaceFetch(`/boards/${boardId}/swimlanes/reorder`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) {
    throw new Error('Failed to reorder swimlanes')
  }
  return res.json()
}
