/** Parser utilities for structured content extraction. */

import { unescapeXml } from './xml'

/**
 * Strip task notification XML tags from message content.
 * These are used for background task correlation but should not be displayed.
 */
export function stripTaskNotifications(message) {
  if (!message) {
    return message
  }
  // Remove <task-notification> tags and their content.
  const stripped = message.replace(/<task-notification\s+[^>]*>[\s\S]*?<\/task-notification>/g, '')
  // Only strip newlines if we removed something (preserve leading/trailing spaces)
  return stripped === message ? message : stripped.replace(/^\n+|\n+$/g, '')
}

/**
 * Walk `<local-command-stdout|stderr>` blocks in `message`, returning interleaved
 * typed segments. Returns null when no blocks are present so callers can branch
 * on absence without re-running the regex.
 *
 * Segment shape: { type: 'text' | 'stdout' | 'stderr', content: string }
 */
export function parseLocalCommandSegments(message) {
  const blockPattern = /<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/g
  if (!blockPattern.test(message)) {
    return null
  }
  blockPattern.lastIndex = 0
  const segments = []
  let lastIndex = 0
  let match
  while ((match = blockPattern.exec(message)) !== null) {
    if (match.index > lastIndex) {
      const text = message.slice(lastIndex, match.index).trim()
      if (text) {
        segments.push({ type: 'text', content: text })
      }
    }
    const content = match[2].trim()
    if (content) {
      segments.push({ type: match[1], content })
    }
    lastIndex = blockPattern.lastIndex
  }
  if (lastIndex < message.length) {
    const text = message.slice(lastIndex).trim()
    if (text) {
      segments.push({ type: 'text', content: text })
    }
  }
  return segments
}

/**
 * Parse local command output and structured responses from user messages.
 *
 * Returns array of segments: { type: 'text' | 'stdout' | 'stderr' | 'qa', content: string, questions?: [] }
 */
export function parseLocalCommandOutput(message) {
  if (!message) {
    return []
  }

  // Strip task notifications before parsing (used for background task correlation, not display)
  message = stripTaskNotifications(message)
  if (!message) {
    return []
  }

  const segments = parseLocalCommandSegments(message)
  if (segments) {
    return segments.length > 0 ? segments : [{ type: 'text', content: message }]
  }

  // response:AskUserQuestion or response:ExitPlanMode: single full-wrap block
  const qaMatch = message.match(
    /^<response:(?:AskUserQuestion|ExitPlanMode)>([\s\S]*?)<\/response:(?:AskUserQuestion|ExitPlanMode)>$/,
  )
  if (qaMatch) {
    const content = qaMatch[1].trim()
    const questions = parseStructuredQA(content)
    if (questions) {
      return [{ type: 'qa', content, questions }]
    }
    return [{ type: 'text', content: message }]
  }

  // No structured tags matched - return as plain text
  return [{ type: 'text', content: message }]
}

/**
 * Parse structured Q/A XML from response:AskUserQuestion format.
 *
 * Returns array of { header, text, answers[] } or null if not valid XML.
 */
export function parseStructuredQA(content) {
  const questions = []
  const questionPattern = /<question\s+header="([^"]*)"\s+text="([^"]*)">([\s\S]*?)<\/question>/g
  const answerPattern = /<answer>([\s\S]*?)<\/answer>/g

  let match
  while ((match = questionPattern.exec(content)) !== null) {
    const header = unescapeXml(match[1])
    const text = unescapeXml(match[2])
    const answersBlock = match[3]

    const answers = []
    let answerMatch
    while ((answerMatch = answerPattern.exec(answersBlock)) !== null) {
      answers.push(unescapeXml(answerMatch[1]))
    }
    // Reset pattern for next question's answers
    answerPattern.lastIndex = 0

    if (answers.length > 0) {
      questions.push({ header, text, answers })
    }
  }

  return questions.length > 0 ? questions : null
}

/**
 * Parse grep line and return structured data for rendering.
 *
 * Handles two formats:
 * - With file path: file:linenum:content or file:linenum-content (directory search)
 * - Without file path: linenum:content or linenum-content (single file search)
 *
 * When outputMode is 'files_with_matches', skip line:content parsing since
 * output is just file paths (which may contain patterns like -51- in filenames).
 */
export function parseGrepLine(line, outputMode = null) {
  // Normalize trailing whitespace/carriage returns
  line = line.trimEnd()

  if (line === '--') {
    return { type: 'separator' }
  }

  // Files-only mode: treat all non-separator lines as file paths
  if (outputMode === 'files_with_matches') {
    // Summary line "Found X files" - return as plain (filtered in GrepContent)
    if (/^Found \d+ files?$/.test(line)) {
      return { type: 'plain', content: line }
    }
    if (line.match(/^[^\s]/)) {
      return { type: 'file', path: line }
    }
    return { type: 'plain', content: line }
  }

  // Format with file path: file:linenum:content or file:linenum-content
  const fullMatch = line.match(/^(.+?)([:])(\d+)([:])(.*)$/) || line.match(/^(.+?)(-)(\d+)(-)(.*)$/)
  if (fullMatch) {
    return {
      type: 'result',
      isMatch: fullMatch[2] === ':',
      file: fullMatch[1],
      sep1: fullMatch[2],
      lineNum: fullMatch[3],
      sep2: fullMatch[4],
      content: fullMatch[5],
    }
  }

  // Format without file path: linenum:content or linenum-content (single file search)
  const simpleMatch = line.match(/^(\d+)([:])(.*)$/) || line.match(/^(\d+)(-)(.*)$/)
  if (simpleMatch) {
    return {
      type: 'result',
      isMatch: simpleMatch[2] === ':',
      file: null,
      sep1: '',
      lineNum: simpleMatch[1],
      sep2: simpleMatch[2],
      content: simpleMatch[3],
    }
  }

  if (line.match(/^[^\s].*\.\w+$/)) {
    return { type: 'file', path: line }
  }

  return { type: 'plain', content: line }
}

/**
 * Parse persisted output wrapper from tool result.
 * Returns { isPersisted, filePath, fileSize, preview, originalContent } or null if not persisted.
 */
export function parsePersistedOutput(content) {
  const match = content.match(/<persisted-output>([\s\S]*?)<\/persisted-output>/)
  if (!match) {
    return null
  }

  const innerContent = match[1].trim()

  // Parse file info: "Output too large (50.7KB). Full output saved to: /path/to/file.txt"
  const fileInfoMatch = innerContent.match(
    /Output too large \(([^)]+)\)\. Full output saved to: ([^\n]+)/,
  )
  const filePath = fileInfoMatch?.[2]?.trim() || null
  const fileSize = fileInfoMatch?.[1] || null

  // Parse preview: "Preview (first 2KB):\n{content}"
  const previewMatch = innerContent.match(/Preview \(first ([^)]+)\):\n([\s\S]*)/)
  const previewSize = previewMatch?.[1] || null
  const preview = previewMatch?.[2]?.trim() || null

  return {
    isPersisted: true,
    filePath,
    fileSize,
    previewSize,
    preview,
    originalContent: innerContent,
  }
}

/**
 * Parse slash command XML tags from user message.
 */
export function parseSlashCommand(content) {
  const match = content.match(
    /<command-name>([^<]+)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/,
  )
  if (match) {
    return { cmd: match[1], args: match[2]?.trim() || '' }
  }
  return null
}
