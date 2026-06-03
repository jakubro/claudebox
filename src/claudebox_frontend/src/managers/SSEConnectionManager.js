/** SSE connection lifecycle — connect, disconnect, reconnect scheduling, state tracking. */

import { RECONNECT_BASE_DELAY, RECONNECT_MAX_DELAY } from '../config/timing'
import { SSE_URL } from '../config/urls'

/**
 * Connection states:
 *   'disconnected'  — initial / after explicit disconnect
 *   'connecting'    — EventSource created, waiting for open
 *   'connected'     — EventSource open, receiving events
 *   'reconnecting'  — connection lost, reconnect scheduled with backoff
 *   'error'         — permanent error (unused currently, reserved)
 */
const VALID_STATUSES = new Set(['disconnected', 'connecting', 'connected', 'reconnecting', 'error'])

export default class SSEConnectionManager {
  /**
   * @param {object} [options]
   * @param {string} [options.url] - SSE endpoint URL (default: SSE_URL constant).
   * @param {number} [options.baseDelay] - Base reconnect delay in ms (default: RECONNECT_BASE_DELAY).
   * @param {number} [options.maxDelay] - Max reconnect delay cap in ms (default: RECONNECT_MAX_DELAY).
   * @param {function} [options.onStatusChange] - Called with (status, error?) on every transition.
   * @param {function} [options.onMessage] - Called with parsed event data on each SSE message.
   * @param {number} [options.maxAttempts] - Max consecutive reconnect attempts before giving up (default: unlimited).
   * @param {function} [options.onReconnectExhausted] - Called when maxAttempts reached.
   */
  constructor(options = {}) {
    this._url = options.url ?? SSE_URL
    this._baseDelay = options.baseDelay ?? RECONNECT_BASE_DELAY
    this._maxDelay = options.maxDelay ?? RECONNECT_MAX_DELAY
    this._onStatusChange = options.onStatusChange ?? (() => {})
    this._onMessage = options.onMessage ?? (() => {})
    this._maxAttempts = options.maxAttempts ?? null
    this._onReconnectExhausted = options.onReconnectExhausted ?? null

    this._eventSource = null
    this._reconnectTimer = null
    this._status = 'disconnected'
    this._error = null
    this._attempt = 0
    this._closed = false
  }

  /** Current connection status. */
  get status() {
    return this._status
  }

  /** Current error message (null when no error). */
  get error() {
    return this._error
  }

  /** Whether the connection is open. */
  get isConnected() {
    return this._status === 'connected'
  }

  /** Open the SSE connection. No-op if already connecting/connected or permanently closed. */
  connect() {
    if (this._closed) {
      return
    }
    if (this._status === 'connecting' || this._status === 'connected') {
      return
    }
    this._open()
  }

  /** Close the connection and cancel any pending reconnect. */
  disconnect() {
    this._cancelReconnect()
    this._closeEventSource()
    this._setStatus('disconnected')
  }

  /** Force-reconnect: close current connection, clear state, reconnect immediately. */
  reconnect() {
    if (this._closed) {
      return
    }
    this._cancelReconnect()
    this._closeEventSource()
    this._attempt = 0
    this._open()
  }

  /** Permanently close. No reconnects possible. Instance becomes inert. */
  close() {
    this._cancelReconnect()
    this._closeEventSource()
    this._setStatus('disconnected')
    this._closed = true
  }

  // Private

  /** Create a new EventSource and wire up handlers. */
  _open() {
    if (this._closed) {
      return
    }
    this._setStatus('connecting')

    const es = new EventSource(this._url)
    this._eventSource = es

    es.onopen = () => {
      this._attempt = 0
      this._setStatus('connected')
    }

    es.onmessage = e => {
      this._onMessage(e)
    }

    es.onerror = () => {
      es.close()
      this._eventSource = null
      this._setStatus('reconnecting', 'Connection lost')
      this._scheduleReconnect()
    }
  }

  /** Close the current EventSource if open. */
  _closeEventSource() {
    if (this._eventSource) {
      this._eventSource.close()
      this._eventSource = null
    }
  }

  /** Schedule an automatic reconnect with exponential backoff. */
  _scheduleReconnect() {
    if (this._closed) {
      return
    }
    if (this._maxAttempts != null && this._attempt >= this._maxAttempts) {
      this._setStatus('error', 'Connection lost — container may be unavailable')
      this._onReconnectExhausted?.()
      return
    }
    this._cancelReconnect()
    const delay = Math.min(this._baseDelay * 2 ** this._attempt, this._maxDelay)
    this._attempt++
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this._open()
    }, delay)
  }

  /** Cancel a pending reconnect timer. */
  _cancelReconnect() {
    if (this._reconnectTimer != null) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }

  /** Transition to a new status, notify listener. */
  _setStatus(status, error) {
    if (this._closed || !VALID_STATUSES.has(status)) {
      return
    }
    this._status = status
    this._error = error ?? null
    this._onStatusChange(status, this._error)
  }
}
