/** Tests for api/sessions.js session management functions. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FETCH_TIMEOUT_INTERACTIVE_MS, FETCH_TIMEOUT_SESSION_LIFECYCLE_MS } from '../config/timing'
import {
  answerPortRequest,
  forkSession,
  getSession,
  getSessionEvents,
  getToolOutput,
  getToolOutputDownloadUrl,
  listSessionSchedules,
  listSessions,
  newSession,
  resumeSession,
  stopSession,
  updateSession,
  updateSessionPrompt,
} from './sessions'

vi.mock('./apiClient', async importOriginal => ({
  ...(await importOriginal()),
  containerFetch: vi.fn(),
  containerUrl: vi.fn(path => path),
  retryFetch: vi.fn(),
  workspaceFetch: vi.fn(),
}))

import { containerFetch, setAddress, workspaceFetch } from './apiClient'

beforeEach(() => {
  setAddress('c-1', 'addressed-1')
})

// Workspace-scoped endpoints

describe('listSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches sessions list', async () => {
    const data = [{ session_id: 's1' }]
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await listSessions()

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions')
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(listSessions()).rejects.toThrow('Failed to fetch sessions')
  })
})

describe('listSessionSchedules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the running sessions schedule events', async () => {
    const data = { sessions: [{ session_id: 's1', responding_since: null, events: [] }] }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    expect(await listSessionSchedules()).toEqual(data)
    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/schedules')
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(listSessionSchedules()).rejects.toThrow('Failed to fetch session schedules')
  })
})

describe('newSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new session via POST', async () => {
    const data = { session_id: 'new-1', container_id: 'c1' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await newSession()

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/new', {
      method: 'POST',
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(newSession()).rejects.toThrow('Failed to start new session')
  })

  it('sends messages as a JSON body when provided', async () => {
    const data = { session_id: 'new-2', container_id: 'c2', undelivered_messages: [] }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await newSession({ messages: ['/greet ada'] })

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/new', {
      method: 'POST',
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: ['/greet ada'] }),
    })
    expect(result).toEqual(data)
  })

  it('sends the bundle alone as the body when no messages are given', async () => {
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    await newSession({ bundle: 'research' })

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/new', {
      method: 'POST',
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
      headers: { 'Content-Type': 'application/json' },
      body: '{"bundle":"research"}',
    })
  })

  it('sends messages and bundle together', async () => {
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    await newSession({ messages: ['/greet ada'], bundle: 'ops' })

    expect(workspaceFetch.mock.calls[0][1].body).toBe('{"messages":["/greet ada"],"bundle":"ops"}')
  })

  it('omits the body when messages is an empty array', async () => {
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    await newSession({ messages: [] })

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/new', {
      method: 'POST',
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
    })
  })
})

describe('updateSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with session data', async () => {
    workspaceFetch.mockResolvedValue({ ok: true })

    await updateSession('s1', { name: 'Renamed' })

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(updateSession('s1', {})).rejects.toThrow('Failed to rename session')
  })
})

describe('resumeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST to resume endpoint and returns response', async () => {
    const data = { session_id: 's1', container_id: 'c1' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await resumeSession('s1')

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/s1/resume', {
      method: 'POST',
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(resumeSession('s1')).rejects.toThrow('Failed to resume session')
  })
})

// Container-scoped endpoints

describe('getSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches current session state', async () => {
    const data = { session_id: 's1', name: 'Test' }
    containerFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await getSession()

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/current?session_id=addressed-1', {
      timeoutMs: FETCH_TIMEOUT_INTERACTIVE_MS,
    })
    expect(result).toEqual(data)
  })

  it('throws with status code on failure', async () => {
    containerFetch.mockResolvedValue({ ok: false, status: 503 })

    await expect(getSession()).rejects.toThrow('Status fetch failed: 503')
  })
})

describe('forkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with turn_id and returns new session', async () => {
    const data = { session_id: 'forked-1' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await forkSession('s1', 't3')

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/s1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turn_id: 't3' }),
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(forkSession('s1', 't1')).rejects.toThrow('Failed to fork session')
  })

  it('sends share_container when set, alongside a null turn_id', async () => {
    workspaceFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session_id: 'side-1' }),
    })

    await forkSession('s1', null, { share_container: true })

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/s1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_container: true }),
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
    })
  })

  it('sends parent_session_id when set, alongside a null turn_id', async () => {
    workspaceFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session_id: 'promoted-1' }),
    })

    await forkSession('side-1', null, { parent_session_id: 'main-1' })

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/side-1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_session_id: 'main-1' }),
      timeoutMs: FETCH_TIMEOUT_SESSION_LIFECYCLE_MS,
    })
  })
})

describe('stopSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST to the session-scoped stop endpoint', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await stopSession('side-1')

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/side-1/stop', { method: 'POST' })
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(stopSession('side-1')).rejects.toThrow('Failed to stop session')
  })
})

describe('getSessionEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches a named session persisted events and running flag', async () => {
    const data = { events: [{ id: 'e1', type: 'assistant' }], running: true }
    containerFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await getSessionEvents('side-1')

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/side-1/events')
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(getSessionEvents('side-1')).rejects.toThrow('Failed to fetch session events')
  })
})

describe('getToolOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches tool output for current session by tool use id', async () => {
    const data = { content: 'output', lines: 5 }
    containerFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await getToolOutput('tu_1')

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/addressed-1/tool-output/tu_1')
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(getToolOutput('tu_1')).rejects.toThrow('Failed to fetch tool output')
  })

  it('addresses a named session when one is given', async () => {
    containerFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    await getToolOutput('tu_1', 'side-1')

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/side-1/tool-output/tu_1')
  })
})

describe('updateSessionPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with session_prompt for current session', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await updateSessionPrompt('Be concise')

    expect(containerFetch).toHaveBeenCalledWith(
      '/api/sessions/current/prompt?session_id=addressed-1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_prompt: 'Be concise' }),
      },
    )
  })

  it('sends null to clear prompt', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await updateSessionPrompt(null)

    const call = containerFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.session_prompt).toBeNull()
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(updateSessionPrompt('x')).rejects.toThrow('Failed to update session prompt')
  })
})

describe('getToolOutputDownloadUrl', () => {
  it('builds download URL for current session tool output', () => {
    expect(getToolOutputDownloadUrl('tu_1')).toBe(
      '/api/sessions/addressed-1/tool-output/tu_1/download',
    )
  })

  it('builds download URL for a named session tool output', () => {
    expect(getToolOutputDownloadUrl('tu_1', 'side-1')).toBe(
      '/api/sessions/side-1/tool-output/tu_1/download',
    )
  })
})

describe('newSession refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the paths and the setting when /tmp would be deleted', async () => {
    workspaceFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({ error: 'container_tmp_mount_conflict', paths: '/tmp/ssh-agent' }),
    })

    const error = await newSession().catch(err => err)

    expect(error.userFacing).toBe(true)
    expect(error.message).toContain('/tmp/ssh-agent')
    expect(error.message).toContain('CLAUDEBOX_NO_TMP_REMAP = "1"')
    expect(workspaceFetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ source: 'workspace' }, ['the workspace settings', '"host"', 'claudebox run']],
    [{ source: 'bundle', bundle: 'web' }, ['bundle web', '"host"']],
  ])('words a network mode refused from %o', async (where, parts) => {
    workspaceFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'network_mode_unsupported', mode: 'host', ...where }),
    })

    const error = await newSession().catch(err => err)

    expect(error.userFacing).toBe(true)
    for (const part of parts) {
      expect(error.message).toContain(part)
    }
  })

  it('keeps the generic message for any other refusal', async () => {
    workspaceFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'bundle_not_declared', bundle: 'x' }),
    })

    const error = await newSession().catch(err => err)

    expect(error.userFacing).toBeUndefined()
    expect(error.message).toBe('Failed to start new session')
  })
})

describe('answerPortRequest refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tells a session started before ports to be stopped and resumed', async () => {
    workspaceFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'port_tunnel_missing', port: '5173' }),
    })

    const error = await answerPortRequest('s-1', 5173, true).catch(err => err)

    expect(error.userFacing).toBe(true)
    expect(error.message).toContain('Stop it, resume it')
  })

  it('keeps the generic message for any other failure', async () => {
    workspaceFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })

    const error = await answerPortRequest('s-1', 5173, true).catch(err => err)

    expect(error.userFacing).toBe(false)
    expect(error.message).toBe('Failed to answer the port request')
  })
})
