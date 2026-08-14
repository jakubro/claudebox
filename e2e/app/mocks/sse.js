/** SSE stream mocks for Playwright E2E tests (browser-side EventSource mock). */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, '../fixtures')

/** Load a JSONL events fixture (one JSON object per line) as an array of event objects. */
function loadEventsFromFixture(relativePath) {
  const fullPath = path.join(fixturesDir, relativePath)
  const content = fs.readFileSync(fullPath, 'utf-8')
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

/** Install shared MockEventSourceBase class into the browser context. */
async function injectMockEventSourceBase(page) {
  await page.addInitScript(() => {
    window.MockEventSourceBase = class MockEventSourceBase {
      constructor() {
        this.readyState = 0 // CONNECTING
        this.onopen = null
        this.onmessage = null
        this.onerror = null
        this._listeners = {}
      }

      addEventListener(type, listener) {
        if (!this._listeners[type]) {
          this._listeners[type] = []
        }
        this._listeners[type].push(listener)
      }

      removeEventListener(type, listener) {
        if (!this._listeners[type]) {
          return
        }
        this._listeners[type] = this._listeners[type].filter(l => l !== listener)
      }

      _emit(type, event) {
        for (const listener of this._listeners[type] || []) {
          listener(event)
        }
      }

      close() {
        this.readyState = 2 // CLOSED
      }
    }
  })
}

/** Mock the SSE stream endpoint by injecting a browser-side EventSource mock. */
export async function mockSSE(page, eventsFixture = 'events/simple-chat.jsonl') {
  const events = loadEventsFromFixture(eventsFixture)
  await injectEventSourceMock(page, events)
}

/** Inject a mock EventSource; guards against re-emitting when StrictMode double-mounts components. */
async function injectEventSourceMock(page, events) {
  await injectMockEventSourceBase(page)
  await page.addInitScript(eventsJson => {
    const events = JSON.parse(eventsJson)

    class MockEventSource extends window.MockEventSourceBase {
      constructor(url) {
        super()
        this.url = url
        const isLogs = url.includes('/api/logs')
        const isDaemon = url.includes('/api/daemon/')

        setTimeout(() => {
          this.readyState = 1 // OPEN
          if (this.onopen) {
            this.onopen(new Event('open'))
          }
          this._emit('open', new Event('open'))

          // Also sets __sseChatInstance, for createSSEController interop.
          if (isLogs) {
            window.__sseActiveLogsInstance = this
          } else if (!isDaemon) {
            window.__sseActiveChatInstance = this
            window.__sseChatInstance = this
          }

          // Only emit fixture events on the chat SSE stream
          if (isLogs || isDaemon) {
            return
          }

          // Wrap events in replay boundaries unless present: SessionRoutingEffect's startResume()
          // sets isResuming=true and replay_ended clears it. Skip if the fixture already has
          // replay_started (e.g. resuming.jsonl, which intentionally stays in resuming state).
          const hasReplayBoundary = events.some(
            e => e.type === 'system' && e.subtype === 'replay_started',
          )
          let allEvents
          if (hasReplayBoundary) {
            allEvents = events
          } else {
            allEvents = [
              { type: 'system', subtype: 'replay_started', count: events.length },
              ...events,
              { type: 'system', subtype: 'replay_ended' },
            ]
          }

          const instance = this
          allEvents.forEach((event, i) => {
            setTimeout(
              () => {
                if (instance.readyState === 1 && window.__sseActiveChatInstance === instance) {
                  const msgEvent = { data: JSON.stringify(event) }
                  if (instance.onmessage) {
                    instance.onmessage(msgEvent)
                  }
                  instance._emit('message', msgEvent)
                }
              },
              10 + i * 5,
            )
          })
        }, 10)
      }
    }

    window.MockEventSource = MockEventSource
    window.EventSource = window.MockEventSource
  }, JSON.stringify(events))
}

/** Mock SSE with dynamic events, for interactive tests. */
export async function mockSSEDynamic(page, eventProvider) {
  const events = eventProvider()
  await injectEventSourceMock(page, events)
}

/**
 * Inject a controllable multi-stream MockEventSource; shared by createSSEController,
 * createDaemonSSEController, and createLogsSSEController.
 */
async function injectControllableMock(page, { autoConnect, trackDaemon, countConnections }) {
  await injectMockEventSourceBase(page)
  await page.addInitScript(
    opts => {
      if (opts.countConnections) {
        window.__sseConnectionCount = 0
      }
      if (opts.trackDaemon) {
        window.__daemonSSEInstance = null
      }
      window.__sseChatInstance = null
      window.__sseLogsInstance = null

      class MockEventSource extends window.MockEventSourceBase {
        constructor(url) {
          super()
          this.url = url
          if (opts.countConnections) {
            window.__sseConnectionCount++
          }

          const isDaemon = opts.trackDaemon && url.includes('/api/daemon/stream')
          const isLogs = url.includes('/api/logs')

          if (isDaemon) {
            window.__daemonSSEInstance = this
          } else if (isLogs) {
            window.__sseLogsInstance = this
          } else {
            window.__sseChatInstance = this
          }

          if (opts.autoConnect) {
            setTimeout(() => {
              // Honor the kill flag set by chat.kill(): simulates a container death where the
              // stream never reconnects until a fresh container_id arrives.
              if (!(isDaemon || isLogs) && window.__chatSSEKilled) {
                this.readyState = 2
                if (this.onerror) {
                  this.onerror(new Event('error'))
                }
                this._emit('error', new Event('error'))
                if (window.__sseChatInstance === this) {
                  window.__sseChatInstance = null
                }
                return
              }
              this.readyState = 1
              if (this.onopen) {
                this.onopen(new Event('open'))
              }
              this._emit('open', new Event('open'))

              // Chat SSE needs replay boundaries to clear isResuming
              if (!(isLogs || isDaemon)) {
                const emitReplay = (event, delay) => {
                  setTimeout(() => {
                    if (this.readyState === 1 && window.__sseChatInstance === this) {
                      const msg = { data: JSON.stringify(event) }
                      if (this.onmessage) {
                        this.onmessage(msg)
                      }
                      this._emit('message', msg)
                    }
                  }, delay)
                }
                emitReplay({ type: 'system', subtype: 'replay_started', count: 0 }, 5)
                emitReplay({ type: 'system', subtype: 'replay_ended' }, 10)
              }
            }, 10)
          }
        }

        close() {
          this.readyState = 2
          if (opts.trackDaemon && window.__daemonSSEInstance === this) {
            window.__daemonSSEInstance = null
          }
          if (window.__sseChatInstance === this) {
            window.__sseChatInstance = null
          }
          if (window.__sseLogsInstance === this) {
            window.__sseLogsInstance = null
          }
        }
      }

      window.EventSource = MockEventSource
    },
    { autoConnect, trackDaemon, countConnections },
  )
}

/** Send a message to a browser-side SSE instance. */
async function sendToInstance(page, instanceName, event) {
  await page.evaluate(
    ({ instanceName, eventJson }) => {
      const event = JSON.parse(eventJson)
      const instance = window[instanceName]
      if (instance?.readyState === 1) {
        const msg = { data: JSON.stringify(event) }
        if (instance.onmessage) {
          instance.onmessage(msg)
        }
        instance._emit('message', msg)
      }
    },
    { instanceName, eventJson: JSON.stringify(event) },
  )
}

/**
 * Create a controllable SSE mock for testing interrupt and reconnect. Call before
 * page.goto(); use the returned controller's methods after the page loads.
 */
export async function createSSEController(page, { autoConnect = true } = {}) {
  await injectControllableMock(page, {
    autoConnect,
    trackDaemon: false,
    countConnections: true,
  })

  return {
    /** Manually connect a deferred SSE stream (when autoConnect: false) */
    async connect() {
      await page.evaluate(() => {
        const instance = window.__sseChatInstance
        if (instance && instance.readyState === 0) {
          instance.readyState = 1
          if (instance.onopen) {
            instance.onopen(new Event('open'))
          }
          instance._emit('open', new Event('open'))
        }
      })
    },

    /** Send an event to the connected chat SSE stream */
    async sendEvent(event) {
      await sendToInstance(page, '__sseChatInstance', event)
    },

    /** Send multiple events */
    async sendEvents(events) {
      for (const event of events) {
        await this.sendEvent(event)
      }
    },

    /** Trigger an error on the chat SSE connection */
    async triggerError() {
      await page.evaluate(() => {
        if (window.__sseChatInstance) {
          window.__sseChatInstance.readyState = 2
          if (window.__sseChatInstance.onerror) {
            window.__sseChatInstance.onerror(new Event('error'))
          }
        }
      })
    },

    /**
     * Permanently kill the chat SSE connection: the current instance errors and every
     * subsequent reconnect attempt errors immediately (never reaches readyState=1) until
     * reviveChat() lifts the window.__chatSSEKilled flag. Simulates a container death that
     * the chat stream cannot recover from until a fresh container_id arrives.
     */
    async kill() {
      await page.evaluate(() => {
        window.__chatSSEKilled = true
        const inst = window.__sseChatInstance
        if (inst) {
          inst.readyState = 2
          if (inst.onerror) {
            inst.onerror(new Event('error'))
          }
          window.__sseChatInstance = null
        }
      })
    },

    /** Lift the chat SSE kill flag so future connections behave normally. */
    async reviveChat() {
      await page.evaluate(() => {
        window.__chatSSEKilled = false
      })
    },

    /** Get connection count (for verifying reconnects) */
    async getConnectionCount() {
      return page.evaluate(() => window.__sseConnectionCount)
    },
  }
}

/**
 * Create a controllable daemon SSE mock for testing container lifecycle/progress; intercepts
 * `/api/daemon/stream`. Call before page.goto(); use the returned controller after load.
 */
export async function createDaemonSSEController(page) {
  await injectControllableMock(page, {
    autoConnect: true,
    trackDaemon: true,
    countConnections: false,
  })

  return {
    /** Send a raw event to the daemon SSE stream. */
    async sendEvent(event) {
      await sendToInstance(page, '__daemonSSEInstance', event)
    },

    /** Send a session_progress event with a message string. */
    async sendProgress(message) {
      await this.sendEvent({ type: 'session_progress', message })
    },

    /** Send a container_status event. */
    async sendContainerStatus(containerId, status) {
      await this.sendEvent({ type: 'container_status', container_id: containerId, status })
    },

    /**
     * Simulate the daemon dropping its SSE. The production useSSE hook detects
     * readyState=2 + onerror and reconnects after RECONNECT_BASE_DELAY (1s); the new
     * MockEventSource auto-opens, incrementing daemonReconnected in useDaemonStream.
     */
    async disconnect() {
      await page.evaluate(() => {
        const instance = window.__daemonSSEInstance
        if (instance) {
          instance.readyState = 2
          if (instance.onerror) {
            instance.onerror(new Event('error'))
          }
          instance._emit('error', new Event('error'))
          window.__daemonSSEInstance = null
        }
      })
    },
  }
}

/**
 * Create a controllable logs SSE mock for testing the logs panel. Must be called before
 * page.goto(); use the returned controller's methods after the page loads.
 */
export async function createLogsSSEController(page) {
  await injectControllableMock(page, {
    autoConnect: true,
    trackDaemon: false,
    countConnections: false,
  })

  return {
    /** Send a log entry to the logs SSE stream */
    async sendLog(log) {
      await sendToInstance(page, '__sseLogsInstance', log)
    },

    /** Send multiple log entries */
    async sendLogs(logs) {
      for (const log of logs) {
        await this.sendLog(log)
      }
    },

    /** Trigger an error on the logs SSE connection */
    async triggerLogsError() {
      await page.evaluate(() => {
        const instance = window.__sseLogsInstance
        if (instance) {
          instance.readyState = 2
          if (instance.onerror) {
            instance.onerror(new Event('error'))
          }
          // Use cached ref - onerror may call close() which nulls the global.
          instance._emit('error', new Event('error'))
        }
      })
    },
  }
}
