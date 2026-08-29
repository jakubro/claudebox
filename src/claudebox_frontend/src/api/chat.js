/** Chat API client functions - container-proxied endpoints. */

import { containerFetch } from './apiClient'

/** Error indicating the container no longer exists (stale container ID after daemon restart). */
export class ContainerGoneError extends Error {
  constructor(message = 'Container no longer exists') {
    super(message)
    this.name = 'ContainerGoneError'
  }
}

/** Raise ContainerGoneError on a stale-container status, else a generic send failure. */
function throwOnSendFailure(res) {
  if (res.status === 404 || res.status === 410 || res.status === 502 || res.status === 504) {
    throw new ContainerGoneError()
  }
  throw new Error('Failed to send message')
}

/**
 * Send a user message with optional attachments, inline replies, and a note to the active session.
 * @param {string} prompt - The message text.
 * @param {object} [options]
 * @param {Array} [options.attachments] - Attachment payloads ({name, type, data}).
 * @param {Array} [options.inlineReplies] - Inline reply pairs ({quote, from, response}).
 * @param {string} [options.note] - Message typed alongside an AskUserQuestion/ExitPlanMode answer.
 */
export async function sendMessage(
  prompt,
  { attachments = [], inlineReplies = null, note = null } = {},
) {
  const body = { prompt }
  if (attachments?.length > 0) {
    body.attachments = attachments.map(a => ({
      name: a.name,
      type: a.type,
      data: a.data,
    }))
  }
  if (inlineReplies?.length > 0) {
    body.inline_replies = inlineReplies
  }
  if (note?.trim()) {
    body.note = note
  }
  const res = await containerFetch('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throwOnSendFailure(res)
  }
}

/** Interrupt the currently running assistant response. */
export async function interrupt() {
  await containerFetch('/api/interrupt', {
    method: 'POST',
  })
}

/**
 * Send a single prompt to a named session rather than the active one, via the container API's
 * optional session_id query param. No attachments, note, or inline replies.
 * @param {string} sessionId
 * @param {string} prompt
 */
export async function sendSideMessage(sessionId, prompt) {
  const res = await containerFetch(`/api/send?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) {
    throwOnSendFailure(res)
  }
}

/** Interrupt a named session's assistant response - a side thread's own stop. */
export async function interruptSide(sessionId) {
  await containerFetch(`/api/interrupt?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
  })
}
