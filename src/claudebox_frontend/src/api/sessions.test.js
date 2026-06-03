/** Tests for api/sessions.js session management functions. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forkSession,
  getSession,
  getToolOutput,
  getToolOutputDownloadUrl,
  listSessions,
  newSession,
  resumeSession,
  updateSession,
  updateSessionPrompt,
} from './sessions'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
  containerUrl: vi.fn(path => path),
  workspaceFetch: vi.fn(),
}))

import { containerFetch, workspaceFetch } from './apiClient'

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

describe('newSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new session via POST', async () => {
    const data = { session_id: 'new-1', container_id: 'c1' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await newSession()

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/new', { method: 'POST' })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(newSession()).rejects.toThrow('Failed to start new session')
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

    expect(workspaceFetch).toHaveBeenCalledWith('/sessions/s1/resume', { method: 'POST' })
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

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/current')
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
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(forkSession('s1', 't1')).rejects.toThrow('Failed to fork session')
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

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/current/tool-output/tu_1')
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false })

    await expect(getToolOutput('tu_1')).rejects.toThrow('Failed to fetch tool output')
  })
})

describe('updateSessionPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with session_prompt for current session', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await updateSessionPrompt('Be concise')

    expect(containerFetch).toHaveBeenCalledWith('/api/sessions/current/prompt', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_prompt: 'Be concise' }),
    })
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
    expect(getToolOutputDownloadUrl('tu_1')).toBe('/api/sessions/current/tool-output/tu_1/download')
  })
})
