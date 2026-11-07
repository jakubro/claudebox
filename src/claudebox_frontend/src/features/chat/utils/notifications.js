/** Notification helper functions for desktop alerts and audio. */

import { EventSubtype, EventType, normalizeToolName, ToolName } from '../../../config/schema'
import { isHumanEvent, isSiblingMessage } from '../../../utils/eventPredicates'

const ASKING_TOOLS = new Set([
  ToolName.NEEDS_USER,
  ToolName.ASK_USER_QUESTION,
  ToolName.EXIT_PLAN_MODE,
])

export function playChime() {
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = 440
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15)

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.15)
  } catch (e) {
    console.warn('useNotifications: Audio playback failed', e)
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return 'denied'
  }
  if (Notification.permission === 'granted') {
    return 'granted'
  }
  if (Notification.permission !== 'denied') {
    return await Notification.requestPermission()
  }
  return Notification.permission
}

export function getResponsePreview(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    // Only use text subtype, not thinking
    if (e.type === EventType.ASSISTANT && e.subtype === EventSubtype.TEXT && e.content) {
      const text = e.content.trim()
      if (text.length > 50) {
        return `${text.slice(0, 50)}...`
      }
      return text
    }
  }
  return 'Response complete'
}

/**
 * Where the last finished run came from: a session this one spawned (no message of the user's since
 * the previous run's reply, and a sibling's message the last thing to start one), and whether it asks.
 * @returns {{fromSibling: boolean, asksUser: boolean}}
 */
export function finishedRunOrigin(events) {
  const top = events.filter(event => !event.parent_tool_use_id)
  const end = lastIndexOf(top, top.length, isResult)

  if (end < 0) {
    return { fromSibling: false, asksUser: false }
  }

  const previousEnd = lastIndexOf(top, end, isResult)
  const firstReply = indexOfFrom(top, previousEnd + 1, end, isReply)
  let windowStart = 0

  if (previousEnd >= 0) {
    const previousReply = indexOfFrom(
      top,
      lastIndexOf(top, previousEnd, isResult) + 1,
      previousEnd,
      isReply,
    )
    windowStart = previousReply >= 0 ? previousReply : previousEnd
  }

  const opener = lastIndexOf(top, firstReply >= 0 ? firstReply : end, isOpener, windowStart)
  const window = top.slice(windowStart, end + 1)
  const run = top.slice(previousEnd + 1, end + 1)

  return {
    fromSibling: opener >= 0 && isSiblingMessage(top[opener]) && !window.some(isHumanEvent),
    asksUser: run.some(
      event =>
        event.subtype === EventSubtype.TOOL_USE &&
        ASKING_TOOLS.has(normalizeToolName(event.tool_name ?? event.content)),
    ),
  }
}

function isResult(event) {
  return event.type === EventType.RESULT
}

function isReply(event) {
  return event.type === EventType.ASSISTANT
}

function isOpener(event) {
  return isSiblingMessage(event) || event.subtype === EventSubtype.TASK_NOTIFICATION
}

function lastIndexOf(items, before, predicate, from = 0) {
  for (let i = before - 1; i >= from; i--) {
    if (predicate(items[i])) {
      return i
    }
  }
  return -1
}

function indexOfFrom(items, from, through, predicate) {
  for (let i = from; i <= through; i++) {
    if (predicate(items[i])) {
      return i
    }
  }
  return -1
}

/** Matches the tab title format. */
export function buildNotificationTitle(sessionName, workspace) {
  const parts = []
  if (sessionName) {
    parts.push(sessionName)
  }
  if (workspace) {
    const workspaceName = workspace.split('/').pop()
    if (workspaceName) {
      parts.push(workspaceName)
    }
  }
  parts.push('Claudebox')
  return parts.join(' | ')
}

export function setTitleIndicator(hasIndicator) {
  const title = document.title
  const hasPrefix = title.startsWith('* ')

  if (hasIndicator && !hasPrefix) {
    document.title = `* ${title}`
  } else if (!hasIndicator && hasPrefix) {
    document.title = title.slice(2)
  }
}
