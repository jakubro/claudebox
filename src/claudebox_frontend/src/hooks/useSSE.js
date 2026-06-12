/** Thin React wrapper around SSEConnectionManager. */

import { useCallback, useEffect, useRef, useState } from 'react'
import SSEConnectionManager from '../managers/SSEConnectionManager'

/**
 * Hook that owns an SSEConnectionManager instance, exposing connection
 * status as React state and forwarding SSE messages to a caller-supplied
 * callback. Recreates the manager when the URL changes (e.g., container switch).
 * Only connects when url is non-null; disconnects on unmount.
 *
 * @param {object} options
 * @param {function} options.onMessage - Called with the raw MessageEvent on each SSE message.
 * @param {string|null} [options.url] - SSE endpoint URL. Null means disconnected.
 * @param {number}   [options.baseDelay] - Base reconnect delay in ms.
 * @param {number}   [options.maxDelay] - Max reconnect delay cap in ms.
 * @param {number}   [options.maxAttempts] - Max consecutive reconnect attempts before giving up.
 * @param {function} [options.onReconnectExhausted] - Called when maxAttempts reached.
 * @returns {{ connectionStatus: string, connectionError: string|null, reconnectSSE: function, disconnectSSE: function, closeSSE: function }}
 */
export default function useSSE({
  onMessage,
  url,
  baseDelay,
  maxDelay,
  maxAttempts,
  onReconnectExhausted,
} = {}) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [connectionError, setConnectionError] = useState(null)
  const managerRef = useRef(null)

  // Stable refs so the manager never needs re-creation for callback changes
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const onReconnectExhaustedRef = useRef(onReconnectExhausted)
  onReconnectExhaustedRef.current = onReconnectExhausted

  // Create/recreate manager when URL changes, connect when URL is non-null
  useEffect(() => {
    if (!url) {
      // No URL - permanently close any existing manager
      if (managerRef.current) {
        managerRef.current.close()
        managerRef.current = null
      }
      setConnectionStatus('disconnected')
      setConnectionError(null)
      return
    }

    // Disconnect previous manager if URL changed
    if (managerRef.current) {
      managerRef.current.disconnect()
    }

    const mgr = new SSEConnectionManager({
      url,
      baseDelay,
      maxDelay,
      maxAttempts,
      onStatusChange: (status, error) => {
        setConnectionStatus(status)
        setConnectionError(error)
      },
      onMessage: e => onMessageRef.current?.(e),
      onReconnectExhausted: () => onReconnectExhaustedRef.current?.(),
    })
    managerRef.current = mgr
    mgr.connect()

    return () => mgr.close()
  }, [url, baseDelay, maxDelay, maxAttempts])

  // Force-reconnect: close + reopen immediately
  const reconnectSSE = useCallback(() => {
    managerRef.current?.reconnect()
  }, [])

  // Graceful disconnect: close without scheduling reconnect
  const disconnectSSE = useCallback(() => {
    managerRef.current?.disconnect()
  }, [])

  // Permanent close: no reconnects possible, instance becomes inert
  const closeSSE = useCallback(() => {
    managerRef.current?.close()
    managerRef.current = null
  }, [])

  return { connectionStatus, connectionError, reconnectSSE, disconnectSSE, closeSSE }
}
