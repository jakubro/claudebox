/** Chat API client functions - container-proxied endpoints. */

import { containerFetch } from './apiClient'

/** Error indicating the container no longer exists (stale container ID after daemon restart). */
export class ContainerGoneError extends Error {
  constructor(message = 'Container no longer exists') {
    super(message)
    this.name = 'ContainerGoneError'
  }
}

/** Send a user message with optional attachments to the active session. */
export async function sendMessage(prompt, attachments = []) {
  const body = { prompt }
  if (attachments?.length > 0) {
    body.attachments = attachments.map(a => ({
      name: a.name,
      type: a.type,
      data: a.data,
    }))
  }
  const res = await containerFetch('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    if (res.status === 404 || res.status === 410 || res.status === 502 || res.status === 504) {
      throw new ContainerGoneError()
    }
    throw new Error('Failed to send message')
  }
}

/** Interrupt the currently running assistant response. */
export async function interrupt() {
  await containerFetch('/api/interrupt', {
    method: 'POST',
  })
}
