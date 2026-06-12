/** REST API mocks for Playwright E2E tests. */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mockCapabilities } from '../../../src/claudebox_frontend/src/test-utils/mockCapabilities.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, '../fixtures')

/** Default workspace and container IDs used across e2e mocks. */
export const DEFAULT_WORKSPACE_ID = 'test-ws'
export const DEFAULT_CONTAINER_ID = 'test-cid'
export const DEFAULT_BACKEND_ID = 'abcdef0123456789-runtime'
export const DEFAULT_SESSION_ID = 'test-session-001'

/** Hash URL for navigating to the default test session. */
export const DEFAULT_SESSION_URL = `/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`

/** Workspace-scoped URL prefix. */
function wsPrefix(wsId = DEFAULT_WORKSPACE_ID) {
  return `/api/workspaces/${wsId}`
}

/** Container-proxied URL prefix. */
function cPrefix(wsId = DEFAULT_WORKSPACE_ID, cid = DEFAULT_CONTAINER_ID) {
  return `/api/workspaces/${wsId}/containers/${cid}`
}

/**
 * Load a JSON fixture file.
 *
 * @param {string} relativePath - Path relative to fixtures directory
 * @returns {object} Parsed JSON
 */
export function loadFixture(relativePath) {
  const fullPath = path.join(fixturesDir, relativePath)
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
}

/**
 * Mock all REST API endpoints with workspace/container-proxied URL patterns.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {object} options - Mock options
 * @param {string} [options.sessionsFixture] - Sessions fixture path
 * @param {string} [options.statusFixture] - Status fixture path
 * @param {object} [options.handlers] - Custom handlers to override defaults
 */
export async function mockAPI(page, options = {}) {
  const sessionsFixture = options.sessionsFixture || 'sessions/default.json'
  const statusFixture = options.statusFixture || 'status/default.json'
  const handlers = options.handlers || {}

  const ws = wsPrefix()
  const cp = cPrefix()

  // --- Top-level workspace endpoints ---

  // GET /api/workspaces - Workspace discovery
  await page.route('**/api/workspaces', async route => {
    await route.fulfill({
      json: {
        workspaces: [
          {
            id: DEFAULT_WORKSPACE_ID,
            path: '/home/user/project',
            containers: { running: 0, stopped: 0 },
          },
        ],
      },
    })
  })

  // --- Workspace-scoped endpoints (via workspaceFetch) ---

  // GET/DELETE /api/workspaces/{ws}/containers/:id - Single container ops
  await page.route(new RegExp(`${ws}/containers/[^/]+$`.replace(/\//g, '\\/')), async route => {
    const method = route.request().method()
    if (method === 'GET') {
      if (handlers.getContainer) {
        await handlers.getContainer(route)
      } else {
        await route.fulfill({
          status: 200,
          json: {
            id: DEFAULT_CONTAINER_ID,
            backend_id: DEFAULT_BACKEND_ID,
            port: 8080,
            status: 'running',
            session_id: DEFAULT_SESSION_ID,
          },
        })
      }
    } else if (method === 'DELETE') {
      if (handlers.deleteContainer) {
        await handlers.deleteContainer(route)
      } else {
        await route.fulfill({ status: 200, json: { id: 'deleted', status: 'deleted' } })
      }
    } else {
      await route.continue()
    }
  })

  // GET /api/workspaces/{ws}/sessions - List sessions
  await page.route(`**${ws}/sessions`, async route => {
    if (route.request().method() === 'GET') {
      if (handlers.getSessions) {
        await handlers.getSessions(route)
      } else {
        await route.fulfill({ json: loadFixture(sessionsFixture) })
      }
    } else {
      await route.continue()
    }
  })

  // POST /api/workspaces/{ws}/sessions/new - Create new session
  await page.route(`**${ws}/sessions/new`, async route => {
    if (handlers.newSession) {
      await handlers.newSession(route)
    } else {
      await route.fulfill({
        status: 200,
        json: {
          session_id: 'new-session-id',
          container_id: DEFAULT_CONTAINER_ID,
          name: null,
        },
      })
    }
  })

  // GET /api/workspaces/{ws}/session-defaults - Workspace session defaults
  // (model / permission mode / effort level a new session would inherit, plus
  // the available choice lists). Consumed by the footer's `useSessionDefaults`
  // hook and SessionDataProvider's available-list seed on the welcome screen.
  await page.route(`**${ws}/session-defaults`, async route => {
    if (handlers.getSessionDefaults) {
      await handlers.getSessionDefaults(route)
    } else {
      await route.fulfill({
        json: {
          workspace: '/home/user/project',
          model: 'claude-opus-4-8',
          permission_mode: 'default',
          effort_level: 'xhigh',
          runtime_name: 'Claude',
          capabilities: mockCapabilities(),
          available_models: [
            { id: 'claude-fable-5', name: 'Fable 5', context_window: 1000000 },
            { id: 'claude-mythos-5', name: 'Mythos 5', context_window: 1000000 },
            { id: 'claude-opus-4-8', name: 'Opus 4.8', context_window: 1000000 },
            { id: 'claude-opus-4-7', name: 'Opus 4.7', context_window: 200000 },
            { id: 'claude-opus-4-6', name: 'Opus 4.6', context_window: 200000 },
            { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', context_window: 200000 },
            { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', context_window: 200000 },
          ],
          available_permission_modes: [
            { id: 'default', name: 'Default', description: 'Standard permission behavior' },
            { id: 'plan', name: 'Plan', description: 'Planning mode' },
            { id: 'acceptEdits', name: 'Auto', description: 'Auto-accept file edits' },
            { id: 'bypassPermissions', name: 'Bypass', description: 'Bypass permission checks' },
          ],
          available_effort_levels: [
            { id: 'max', name: 'Max' },
            { id: 'xhigh', name: 'XHigh' },
            { id: 'high', name: 'High' },
            { id: 'medium', name: 'Medium' },
            { id: 'low', name: 'Low' },
          ],
        },
      })
    }
  })

  // GET /api/workspaces/{ws}/commands - Workspace command catalog
  // Filesystem-discovered slash commands and skills exposed to the welcome
  // screen picker before any container session attaches. Shape mirrors the
  // in-session `commands` field — `{custom, mcp, builtin}`.
  await page.route(`**${ws}/commands`, async route => {
    if (handlers.getCommandCatalog) {
      await handlers.getCommandCatalog(route)
    } else {
      await route.fulfill({
        json: {
          custom: [{ name: 'help' }, { name: 'clear' }, { name: 'compact' }],
          mcp: [],
          builtin: [],
        },
      })
    }
  })

  // POST /api/workspaces/{ws}/sessions/:id/resume - Resume session
  await page.route(new RegExp(`${ws}/sessions/[^/]+/resume`.replace(/\//g, '\\/')), async route => {
    if (handlers.resumeSession) {
      await handlers.resumeSession(route)
    } else {
      await route.fulfill({
        status: 200,
        json: {
          session_id: DEFAULT_SESSION_ID,
          container_id: DEFAULT_CONTAINER_ID,
        },
      })
    }
  })

  // GET/PATCH /api/workspaces/{ws}/sessions/:id - Get or update session
  // Exclude reserved paths: new, and paths with additional segments
  await page.route(
    new RegExp(`${ws}/sessions/(?!new$)[^/]+$`.replace(/\//g, '\\/')),
    async route => {
      if (route.request().method() === 'PATCH') {
        if (handlers.updateSession) {
          await handlers.updateSession(route)
        } else {
          const data = await route.request().postDataJSON()
          const status = loadFixture(statusFixture)
          await route.fulfill({ status: 200, json: { ...status, ...data } })
        }
      } else if (route.request().method() === 'GET') {
        if (handlers.getSession) {
          await handlers.getSession(route)
        } else {
          await route.fulfill({ json: loadFixture(statusFixture) })
        }
      } else {
        await route.continue()
      }
    },
  )

  // GET/PATCH /api/workspaces/{ws}/ui-state - UI state persistence
  const uiState = { global: {}, sessions: {} }
  await page.route(new RegExp(`${ws}/ui-state`.replace(/\//g, '\\/')), async route => {
    const url = new URL(route.request().url())
    const sessionId = url.searchParams.get('session_id')

    if (route.request().method() === 'GET') {
      if (handlers.getUIState) {
        await handlers.getUIState(route)
      } else {
        const session = sessionId ? uiState.sessions[sessionId] || {} : {}
        await route.fulfill({ json: { global: uiState.global, session } })
      }
    } else if (route.request().method() === 'PATCH') {
      if (handlers.patchUIState) {
        await handlers.patchUIState(route)
      } else {
        const payload = await route.request().postDataJSON()
        applyOps(uiState, 'global', payload.global)
        if (sessionId) {
          if (!uiState.sessions[sessionId]) {
            uiState.sessions[sessionId] = {}
          }
          applyOps(uiState.sessions, sessionId, payload.session)
        }
        const sessionData = sessionId ? uiState.sessions[sessionId] || {} : {}
        await route.fulfill({ json: { global: uiState.global, session: sessionData } })
      }
    }
  })

  // POST /api/workspaces/{ws}/sessions/:id/fork - Fork session
  await page.route(new RegExp(`${ws}/sessions/[^/]+/fork`.replace(/\//g, '\\/')), async route => {
    if (handlers.forkSession) {
      await handlers.forkSession(route)
    } else {
      await route.fulfill({
        status: 200,
        json: { session_id: 'forked-session-001', container_id: DEFAULT_CONTAINER_ID },
      })
    }
  })

  // --- Container-proxied endpoints (via containerFetch) ---

  // GET .../api/sessions/current
  await page.route(`**${cp}/api/sessions/current`, async route => {
    if (handlers.getSessionStatus) {
      await handlers.getSessionStatus(route)
    } else {
      await route.fulfill({ json: loadFixture(statusFixture) })
    }
  })

  // GET .../api/sessions/current/tool-output/:tool_use_id
  await page.route(
    new RegExp(`${cp}/api/sessions/current/tool-output/[^/]+$`.replace(/\//g, '\\/')),
    async route => {
      if (handlers.getToolOutput) {
        await handlers.getToolOutput(route)
      } else {
        await route.fulfill({ json: { content: 'tool output content', lines: 1 } })
      }
    },
  )

  // GET .../api/sessions/current/tool-output/:id/download
  await page.route(
    new RegExp(`${cp}/api/sessions/current/tool-output/[^/]+/download`.replace(/\//g, '\\/')),
    async route => {
      if (handlers.downloadToolOutput) {
        await handlers.downloadToolOutput(route)
      } else {
        await route.fulfill({ status: 200, body: 'file content', contentType: 'text/plain' })
      }
    },
  )

  // PATCH .../api/sessions/current/prompt
  await page.route(
    new RegExp(`${cp}/api/sessions/current/prompt`.replace(/\//g, '\\/')),
    async route => {
      if (handlers.updateSessionPrompt) {
        await handlers.updateSessionPrompt(route)
      } else {
        await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
      }
    },
  )

  // POST .../api/model
  await page.route(`**${cp}/api/model`, async route => {
    if (handlers.setModel) {
      await handlers.setModel(route)
    } else {
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    }
  })

  // POST .../api/permission-mode
  await page.route(`**${cp}/api/permission-mode`, async route => {
    if (handlers.setPermissionMode) {
      await handlers.setPermissionMode(route)
    } else {
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    }
  })

  // POST .../api/effort-level
  await page.route(`**${cp}/api/effort-level`, async route => {
    if (handlers.setEffortLevel) {
      await handlers.setEffortLevel(route)
    } else {
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    }
  })

  // POST .../api/send
  await page.route(`**${cp}/api/send`, async route => {
    if (handlers.send) {
      await handlers.send(route)
    } else {
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    }
  })

  // POST .../api/interrupt
  await page.route(`**${cp}/api/interrupt`, async route => {
    if (handlers.interrupt) {
      await handlers.interrupt(route)
    } else {
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    }
  })

  // POST .../api/files/resolve-paths
  await page.route(`**${cp}/api/files/resolve-paths`, async route => {
    if (handlers.resolvePaths) {
      await handlers.resolvePaths(route)
    } else {
      await route.fulfill({ json: { resolved: {} } })
    }
  })
}

/**
 * Override a single API endpoint with an error response.
 *
 * Must be called AFTER mockAPI() — Playwright routes are LIFO, so the last
 * registered route for a URL pattern takes precedence.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string|RegExp} endpoint - URL pattern to intercept
 * @param {object} [options] - Error options
 * @param {number} [options.status=500] - HTTP status code
 * @param {object} [options.body] - Response body (defaults to { error: 'Server error' })
 * @param {number} [options.timeout] - If set, abort with timeout instead of returning status
 */
export async function mockAPIWithError(page, endpoint, { status = 500, body, timeout } = {}) {
  await page.route(endpoint, async route => {
    if (timeout) {
      await new Promise(resolve => setTimeout(resolve, timeout))
      await route.abort('timedout')
    } else {
      await route.fulfill({ status, json: body || { error: 'Server error' } })
    }
  })
}

/**
 * Apply an array of operations to a target object at a given key.
 *
 * Supports the operation-based ui-state protocol:
 * - set: assign value at dot-path
 * - unset: delete key at dot-path
 * - add: add value to array if not present
 * - remove: remove first occurrence from array
 * - append: append value to array
 */
function applyOps(target, key, ops) {
  if (!Array.isArray(ops)) {
    return
  }
  for (const op of ops) {
    const parts = op.path.split('.')
    let obj = target[key]
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in obj)) {
        obj[parts[i]] = {}
      }
      obj = obj[parts[i]]
    }
    const last = parts[parts.length - 1]
    switch (op.op) {
      case 'set':
        obj[last] = op.value
        break
      case 'unset':
        delete obj[last]
        break
      case 'add':
        if (!Array.isArray(obj[last])) {
          obj[last] = []
        }
        if (!obj[last].includes(op.value)) {
          obj[last].push(op.value)
        }
        break
      case 'remove':
        if (Array.isArray(obj[last])) {
          const idx = obj[last].indexOf(op.value)
          if (idx !== -1) {
            obj[last].splice(idx, 1)
          }
        }
        break
      case 'append':
        if (!Array.isArray(obj[last])) {
          obj[last] = []
        }
        obj[last].push(op.value)
        break
    }
  }
}
