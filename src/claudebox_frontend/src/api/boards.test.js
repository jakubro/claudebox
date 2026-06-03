/** Tests for api/boards.js board CRUD and ticket operations. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveTicket,
  assignTickets,
  createSwimlane,
  deleteSwimlane,
  getBoard,
  getTicketContent,
  listBoards,
  moveTicket,
  renameBoard,
  renameSwimlane,
  reorderStates,
  reorderSwimlanes,
} from './boards'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
  workspaceFetch: vi.fn(),
}))

import { workspaceFetch } from './apiClient'

describe('listBoards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches boards list', async () => {
    const data = [{ id: 'b1', name: 'Sprint' }]
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await listBoards()

    expect(workspaceFetch).toHaveBeenCalledWith('/boards')
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(listBoards()).rejects.toThrow('Failed to fetch boards')
  })
})

describe('getBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches board by id', async () => {
    const data = { id: 'b1', columns: [] }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await getBoard('b1')

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1')
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(getBoard('b1')).rejects.toThrow('Failed to fetch board')
  })
})

describe('renameBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with new name', async () => {
    const data = { id: 'b1', name: 'Renamed' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await renameBoard('b1', 'Renamed')

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(renameBoard('b1', 'x')).rejects.toThrow('Failed to rename board')
  })
})

describe('getTicketContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches raw markdown content via text()', async () => {
    const markdown = '# Ticket\nSome content'
    workspaceFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(markdown) })

    const result = await getTicketContent('b1', 'path/to/ticket.md')

    expect(workspaceFetch).toHaveBeenCalledWith(
      `/boards/b1/tickets/${encodeURIComponent('path/to/ticket.md')}/content`,
    )
    expect(result).toBe(markdown)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(getTicketContent('b1', 'ticket.md')).rejects.toThrow(
      'Failed to fetch ticket content',
    )
  })
})

describe('moveTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with column and swimlane', async () => {
    const data = { moved: true }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await moveTicket('b1', 'path/to/ticket.md', {
      column: 'done',
      swimlane: 'sw1',
    })

    expect(workspaceFetch).toHaveBeenCalledWith(
      `/boards/b1/tickets/${encodeURIComponent('path/to/ticket.md')}/move`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: 'done', swimlane: 'sw1' }),
      },
    )
    expect(result).toEqual(data)
  })

  it('sends PATCH with index when provided', async () => {
    const data = { moved: true }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    await moveTicket('b1', 'path/to/ticket.md', { column: 'done', index: 2 })

    expect(workspaceFetch).toHaveBeenCalledWith(
      `/boards/b1/tickets/${encodeURIComponent('path/to/ticket.md')}/move`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: 'done', swimlane: undefined, index: 2 }),
      },
    )
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(moveTicket('b1', 'ticket.md', { column: 'done' })).rejects.toThrow(
      'Failed to move ticket',
    )
  })
})

describe('archiveTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends DELETE and returns void', async () => {
    workspaceFetch.mockResolvedValue({ ok: true })

    const result = await archiveTicket('b1', 'path/to/ticket.md')

    expect(workspaceFetch).toHaveBeenCalledWith(
      `/boards/b1/tickets/${encodeURIComponent('path/to/ticket.md')}`,
      { method: 'DELETE' },
    )
    expect(result).toBeUndefined()
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(archiveTicket('b1', 'ticket.md')).rejects.toThrow('Failed to archive ticket')
  })
})

describe('assignTickets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with tickets and parallel flag', async () => {
    const data = { assigned: ['t1', 't2'] }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await assignTickets('b1', ['t1', 't2'], { parallel: true })

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickets: ['t1', 't2'], parallel: true }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(assignTickets('b1', ['t1'])).rejects.toThrow('Failed to assign tickets')
  })
})

describe('createSwimlane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with swimlane name', async () => {
    const data = { id: 'sw1', name: 'Urgent' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await createSwimlane('b1', 'Urgent')

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1/swimlanes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Urgent' }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(createSwimlane('b1', 'x')).rejects.toThrow('Failed to create swimlane')
  })
})

describe('renameSwimlane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with new swimlane name', async () => {
    const data = { id: 'sw1', name: 'Renamed' }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await renameSwimlane('b1', 'sw1', 'Renamed')

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1/swimlanes/sw1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(renameSwimlane('b1', 'sw1', 'x')).rejects.toThrow('Failed to rename swimlane')
  })
})

describe('deleteSwimlane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends DELETE and returns void', async () => {
    workspaceFetch.mockResolvedValue({ ok: true })

    const result = await deleteSwimlane('b1', 'sw1')

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1/swimlanes/sw1', {
      method: 'DELETE',
    })
    expect(result).toBeUndefined()
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(deleteSwimlane('b1', 'sw1')).rejects.toThrow('Failed to delete swimlane')
  })
})

describe('reorderStates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with key order', async () => {
    const data = { reordered: true }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await reorderStates('b1', ['todo', 'doing', 'done'])

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1/states/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: ['todo', 'doing', 'done'] }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(reorderStates('b1', ['a'])).rejects.toThrow('Failed to reorder states')
  })
})

describe('reorderSwimlanes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH with id order', async () => {
    const data = { reordered: true }
    workspaceFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })

    const result = await reorderSwimlanes('b1', ['sw2', 'sw1'])

    expect(workspaceFetch).toHaveBeenCalledWith('/boards/b1/swimlanes/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['sw2', 'sw1'] }),
    })
    expect(result).toEqual(data)
  })

  it('throws when response is not ok', async () => {
    workspaceFetch.mockResolvedValue({ ok: false })

    await expect(reorderSwimlanes('b1', ['a'])).rejects.toThrow('Failed to reorder swimlanes')
  })
})
