/** Formatting utilities for display-ready strings. */

import { remark } from 'remark'
import strip from 'strip-markdown'
import { parseLocalCommandSegments, parseSlashCommand, parseStructuredQA } from './parsers'

const stripper = remark().use(strip)

/**
 * Format duration in seconds to human readable format.
 * Examples: "5s", "1m 23s", "1h 5m 12s"
 */
export function formatDuration(seconds) {
  if (seconds < 0) {
    return '0s'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts = []
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }
  parts.push(`${secs}s`)

  // Omit leading zero units
  if (hours === 0 && parts[0] === '0m') {
    parts.shift()
  }

  return parts.join(' ')
}

/**
 * Format milliseconds as HH:MM:SS clock display.
 */
export function formatDurationClock(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Format duration in seconds to compact display showing only the two most significant units.
 * Examples: "45s", "12m", "2h 15m", "3d 5h"
 */
export function formatDurationCompact(seconds) {
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return `${hours}h ${remainingMinutes}m`
  }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

/**
 * Format block timing as compact inline string.
 * Shows duration and/or relative offset from turn start.
 * Examples: "2s · @ +8s", "@ +3s", "45s · @ +1m 12s"
 */
export function formatBlockTiming(duration, relativeTime) {
  const parts = []
  if (duration !== null && duration !== undefined) {
    parts.push(formatDuration(duration))
  }
  if (relativeTime !== null && relativeTime !== undefined) {
    parts.push(`@ +${formatDuration(relativeTime)}`)
  }
  return parts.join(' · ')
}

/**
 * Format date as relative time (e.g., "5m ago", "2d ago").
 */
export function formatRelativeTime(date) {
  const now = new Date()
  const diff = now - new Date(date)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  if (hours < 24) {
    return `${hours}h ago`
  }
  if (days < 7) {
    return `${days}d ago`
  }
  return new Date(date).toLocaleDateString()
}

/**
 * Format date as locale absolute time (e.g., "Apr 25, 2026, 7:40 PM").
 */
export function formatAbsoluteTime(date) {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format cost as currency string with K/M/B suffixes.
 */
export function formatCost(cost) {
  if (cost == null) {
    return '-'
  }
  if (cost >= 1_000_000_000) {
    return `$${(cost / 1_000_000_000).toFixed(2)}B`
  }
  if (cost >= 1_000_000) {
    return `$${(cost / 1_000_000).toFixed(2)}M`
  }
  if (cost >= 1_000) {
    return `$${(cost / 1_000).toFixed(2)}K`
  }
  return `$${cost.toFixed(2)}`
}

/** Format turn count as "N turns" string. */
export function formatTurns(turns) {
  if (turns == null) {
    return '-'
  }
  return `${turns} turns`
}

/**
 * Format token count with K suffix for thousands.
 */
export function formatTokens(tokens) {
  if (!tokens) {
    return 'unknown'
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000).toLocaleString()}K`
  }
  return tokens.toLocaleString()
}

/** Extract first line of text, truncated to maxLength. */
export function getFirstLine(text, maxLength = 50) {
  const firstLine = text.split('\n')[0]
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}...` : firstLine
}

/**
 * Strip markdown formatting to plain text.
 */
export function stripMarkdown(text) {
  if (!text) {
    return ''
  }
  return String(stripper.processSync(text)).trim()
}

/** Extract filename from path. */
export function getBasename(path) {
  if (!path) {
    return path
  }
  const parts = path.split('/')
  return parts[parts.length - 1]
}

/**
 * Format file path for header: filename when collapsed, full path when expanded.
 */
export function formatFilePath(filePath, isExpanded) {
  if (!filePath) {
    return 'file'
  }
  return isExpanded ? filePath : filePath.split('/').pop()
}

/**
 * Parse structured Q/A XML and format as plain text.
 */
function formatStructuredQA(content) {
  const questions = parseStructuredQA(content)
  if (!questions) {
    return null
  }
  return questions.map(q => `${q.text}: ${q.answers.join(', ')}`).join('\n')
}

/**
 * Format user message for clipboard copy.
 *
 * Transforms known XML patterns to human-readable text while preserving
 * unknown XML verbatim.
 */
export function formatUserMessageForCopy(message) {
  if (!message) {
    return ''
  }

  // Check for slash command first (entire message is command)
  const slashCmd = parseSlashCommand(message)
  if (slashCmd) {
    const cmd = slashCmd.cmd.startsWith('/') ? slashCmd.cmd : `/${slashCmd.cmd}`
    return slashCmd.args ? `${cmd} ${slashCmd.args}` : cmd
  }

  const segments = parseLocalCommandSegments(message)
  if (segments) {
    return segments.length > 0 ? segments.map(s => s.content).join('\n\n') : message
  }

  // response:AskUserQuestion or response:ExitPlanMode: single full-wrap block
  const qaMatch = message.match(
    /^<response:(?:AskUserQuestion|ExitPlanMode)>([\s\S]*?)<\/response:(?:AskUserQuestion|ExitPlanMode)>$/,
  )
  if (qaMatch) {
    const content = qaMatch[1].trim()
    const formatted = formatStructuredQA(content)
    return formatted || content || message
  }

  // No structured tags matched - return original message
  return message
}

/**
 * Format unix timestamp (seconds) as HH:MM:SS time string.
 */
export function formatTimestamp(unixTimestamp) {
  const date = new Date(unixTimestamp * 1000)
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Extract workspace directory name from full path. */
export function getWorkspaceName(workspace) {
  return workspace ? workspace.split('/').pop() : null
}

/**
 * Format user message for one-line display preview.
 * Parses slash command XML if present, otherwise returns raw content.
 */
export function formatMessagePreview(content) {
  if (!content) {
    return null
  }
  const parsed = parseSlashCommand(content)
  if (parsed) {
    return parsed.args ? `${parsed.cmd} ${parsed.args}` : parsed.cmd
  }
  return content
}

/** Format byte count to human-readable file size (e.g. "1.2 MB", "340 KB"). */
export function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
