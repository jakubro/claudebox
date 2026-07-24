/** Tests for api/chat.js send and interrupt functions. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { interrupt, sendMessage } from './chat'

vi.mock('./apiClient', () => ({
  containerFetch: vi.fn(),
}))

import { containerFetch } from './apiClient'

describe('sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST with prompt in body', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await sendMessage('hello')

    expect(containerFetch).toHaveBeenCalledOnce()
    expect(containerFetch).toHaveBeenCalledWith('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })
  })

  it('includes attachments when provided', async () => {
    containerFetch.mockResolvedValue({ ok: true })
    const attachments = [
      { name: 'file.txt', type: 'text/plain', data: 'base64data', extra: 'ignored' },
    ]

    await sendMessage('with file', { attachments })

    const call = containerFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.prompt).toBe('with file')
    expect(body.attachments).toEqual([{ name: 'file.txt', type: 'text/plain', data: 'base64data' }])
  })

  it('omits attachments key when array is empty', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await sendMessage('no attachments', { attachments: [] })

    const call = containerFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.attachments).toBeUndefined()
  })

  it('includes inline_replies when provided', async () => {
    containerFetch.mockResolvedValue({ ok: true })
    const inlineReplies = [{ quote: 'q', from: 'assistant', response: 'r' }]

    await sendMessage('with replies', { inlineReplies })

    const call = containerFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.inline_replies).toEqual(inlineReplies)
  })

  it('omits inline_replies key when empty', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await sendMessage('none', { inlineReplies: [] })

    const call = containerFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.inline_replies).toBeUndefined()
  })

  it('throws when response is not ok', async () => {
    containerFetch.mockResolvedValue({ ok: false, status: 500 })

    await expect(sendMessage('fail')).rejects.toThrow('Failed to send message')
  })

  it('throws on network error', async () => {
    containerFetch.mockRejectedValue(new Error('Network error'))

    await expect(sendMessage('fail')).rejects.toThrow('Network error')
  })
})

describe('interrupt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends POST to /api/interrupt', async () => {
    containerFetch.mockResolvedValue({ ok: true })

    await interrupt()

    expect(containerFetch).toHaveBeenCalledOnce()
    expect(containerFetch).toHaveBeenCalledWith('/api/interrupt', { method: 'POST' })
  })

  it('throws on network error', async () => {
    containerFetch.mockRejectedValue(new Error('Network error'))

    await expect(interrupt()).rejects.toThrow('Network error')
  })
})
