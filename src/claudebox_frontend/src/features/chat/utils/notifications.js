/** Notification helper functions for desktop alerts and audio. */

import { EventSubtype, EventType } from '../../../config/schema'

/**
 * Play notification chime via Web Audio API.
 *
 * 440Hz sine wave, 150ms duration, 30% volume with exponential decay.
 */
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

/** Request browser notification permission if not already granted. */
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

/**
 * Extract preview text from events for notification body.
 * Excludes thinking blocks - only uses assistant text content.
 */
export function getResponsePreview(events) {
  // Find last assistant text content (exclude thinking blocks)
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
 * Build notification title matching tab title format.
 */
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

/**
 * Update document title with indicator prefix.
 */
export function setTitleIndicator(hasIndicator) {
  const title = document.title
  const hasPrefix = title.startsWith('* ')

  if (hasIndicator && !hasPrefix) {
    document.title = `* ${title}`
  } else if (!hasIndicator && hasPrefix) {
    document.title = title.slice(2)
  }
}
