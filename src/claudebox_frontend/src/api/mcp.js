/** MCP server management API client — reconnect, toggle, status. */

import { containerFetch } from './apiClient'

/** Reconnect a disconnected/failed MCP server. Returns fresh status. */
export async function reconnectMcpServer(serverName) {
  const res = await containerFetch('/api/mcp/reconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server_name: serverName }),
  })
  if (!res.ok) {
    throw new Error('Failed to reconnect MCP server')
  }
  return res.json()
}

/** Toggle an MCP server enabled/disabled. Returns fresh status. */
export async function toggleMcpServer(serverName, enabled) {
  const res = await containerFetch('/api/mcp/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server_name: serverName, enabled }),
  })
  if (!res.ok) {
    throw new Error('Failed to toggle MCP server')
  }
  return res.json()
}
