/** Panel showing MCP server status with reconnect and enable/disable controls. */

import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reconnectMcpServer, toggleMcpServer } from '../../api/mcp'
import { ERROR_AUTO_CLEAR_MS } from '../../config/timing'
import { useEvents } from '../../context/EventsContext'
import useCapabilities from '../../hooks/useCapabilities'
import { getMcpServers } from '../../utils/eventProcessing'
import { statusClass } from './utils/serverStatus'

/** Render panel showing MCP server status with management controls. */
export default function McpPanel() {
  const { capabilities } = useCapabilities()
  const { events, isResuming, isReplaying } = useEvents()
  const [statusOverride, setStatusOverride] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [loadingServer, setLoadingServer] = useState(null)
  const errorTimerRef = useRef(null)

  const eventServers = useMemo(() => getMcpServers(events), [events])
  const servers = statusOverride || eventServers

  // Clear status override when new events arrive (e.g., after compaction/resume)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - only react to eventServers changes, not statusOverride
  useEffect(() => {
    if (statusOverride && eventServers.length > 0) {
      setStatusOverride(null)
    }
  }, [eventServers])

  const showError = useCallback(message => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current)
    }
    setActionError(message)
    errorTimerRef.current = setTimeout(() => setActionError(null), ERROR_AUTO_CLEAR_MS)
  }, [])

  const handleReconnect = useCallback(
    async serverName => {
      setLoadingServer(serverName)
      try {
        const result = await reconnectMcpServer(serverName)
        setStatusOverride(result.mcpServers)
      } catch {
        showError(`Failed to reconnect ${serverName}`)
      } finally {
        setLoadingServer(null)
      }
    },
    [showError],
  )

  const handleToggle = useCallback(
    async (serverName, enabled) => {
      setLoadingServer(serverName)
      try {
        const result = await toggleMcpServer(serverName, enabled)
        setStatusOverride(result.mcpServers)
      } catch {
        showError(`Failed to ${enabled ? 'enable' : 'disable'} ${serverName}`)
      } finally {
        setLoadingServer(null)
      }
    },
    [showError],
  )

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current)
      }
    }
  }, [])

  if (isResuming || isReplaying) {
    return (
      <div className="panel-content mcp-panel mcp-empty" data-testid="panel-mcp">
        Resuming...
      </div>
    )
  }

  if (capabilities && !capabilities.supports_mcp_delegation) {
    return null
  }

  if (servers.length === 0 && !actionError) {
    return (
      <div className="panel-content mcp-panel mcp-empty" data-testid="panel-mcp">
        No MCP servers connected
      </div>
    )
  }

  return (
    <div className="panel-content mcp-panel" data-testid="panel-mcp">
      {actionError && <div className="mcp-error">{actionError}</div>}
      <div className="mcp-server-list">
        {servers.length === 0 ? (
          <p className="mcp-empty">No MCP servers connected</p>
        ) : (
          servers.map(server => {
            const isLoading = loadingServer === server.name
            const isDisconnected = server.status === 'disconnected' || server.status === 'failed'
            const isDisabled = server.status === 'disabled'
            const isConnected = server.status === 'connected'

            return (
              <div key={server.name} className="mcp-server-item">
                <span
                  className={`mcp-status-dot ${statusClass(server.status)}`}
                  title={server.status}
                />
                <span className="mcp-server-name">{server.name}</span>
                {!(isConnected || isDisabled) && (
                  <span className="mcp-server-status">{server.status}</span>
                )}
                <span className="mcp-server-actions">
                  {isDisconnected && (
                    <button
                      type="button"
                      className="mcp-action-btn"
                      title="Reconnect"
                      disabled={isLoading}
                      onClick={() => handleReconnect(server.name)}>
                      <RefreshCw size={12} className={isLoading ? 'spinner' : ''} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`mcp-toggle-btn ${isDisabled ? 'toggled-off' : 'toggled-on'}`}
                    title={isDisabled ? 'Enable' : 'Disable'}
                    disabled={isLoading}
                    onClick={() => handleToggle(server.name, isDisabled)}>
                    {isDisabled ? 'Enable' : 'Disable'}
                  </button>
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
