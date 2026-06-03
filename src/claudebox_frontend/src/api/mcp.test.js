/** Tests for api/mcp.js MCP server management functions. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reconnectMcpServer, toggleMcpServer } from './mcp'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
}))

import { containerFetch } from './apiClient'

describe('reconnectMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with server_name', async () => {
    const data = { mcpServers: [{ name: 'jina', status: 'connected' }] }
    containerFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await reconnectMcpServer('jina')

    expect(containerFetch).toHaveBeenCalledWith('/api/mcp/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_name: 'jina' }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(reconnectMcpServer('jina')).rejects.toThrow('Failed to reconnect MCP server')
  })
})

describe('toggleMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with server_name and enabled flag', async () => {
    const data = { mcpServers: [{ name: 'jina', status: 'disabled' }] }
    containerFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await toggleMcpServer('jina', false)

    expect(containerFetch).toHaveBeenCalledWith('/api/mcp/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_name: 'jina', enabled: false }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(toggleMcpServer('jina', true)).rejects.toThrow('Failed to toggle MCP server')
  })
})
